const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const MANAGED_ROLES = new Set(["student", "teacher"]);

const cleanString = (value) => String(value || "").trim();
const normalizeEmail = (value) => cleanString(value).toLowerCase();

const buildClaimsForRole = (role) => {
  if (role === "admin") {
    return { admin: true, teacher: true };
  }
  if (role === "teacher") {
    return { teacher: true };
  }
  return {};
};

const setClaimsForRole = async (uid, role) => {
  await admin.auth().setCustomUserClaims(uid, buildClaimsForRole(role));
};

const getUserDoc = async (uid) => {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap : null;
};

const getAuthUserByEmail = async (email) => {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return null;
    }
    throw error;
  }
};

const ensureAdmin = async (context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Auth required.");
  }

  const emailVerified = context.auth.token.email_verified === true;
  const callerEmail = normalizeEmail(context.auth.token.email);
  if (!emailVerified) {
    throw new functions.https.HttpsError("permission-denied", "Verified email required.");
  }

  if (callerEmail === ADMIN_EMAIL || context.auth.token.admin === true) {
    return;
  }

  const callerDoc = await getUserDoc(context.auth.uid);
  const role = callerDoc?.data()?.role;
  if (role === "admin") {
    return;
  }

  throw new functions.https.HttpsError("permission-denied", "Not allowed.");
};

const sanitizeManagedUser = (data, fallbackRole) => {
  const role = cleanString(data?.role || fallbackRole || "student");
  if (!MANAGED_ROLES.has(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }

  const payload = {
    name: cleanString(data?.name),
    email: normalizeEmail(data?.email),
    password: String(data?.password || ""),
    role,
    class: cleanString(data?.class),
    number: cleanString(data?.number),
    isApproved: data?.isApproved !== false,
  };

  if (!payload.name) {
    throw new functions.https.HttpsError("invalid-argument", "Name is required.");
  }
  if (!payload.email) {
    throw new functions.https.HttpsError("invalid-argument", "Email is required.");
  }
  if (!payload.password || payload.password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  if (payload.role === "student") {
    if (!payload.class) {
      throw new functions.https.HttpsError("invalid-argument", "Class is required for students.");
    }
    if (!payload.number) {
      throw new functions.https.HttpsError("invalid-argument", "Student number is required.");
    }
  }

  return payload;
};

const ensureEmailHasNoConflictingDoc = async (email, expectedUid) => {
  const snap = await db.collection("users").where("email", "==", email).limit(2).get();
  for (const docSnap of snap.docs) {
    if (docSnap.id !== expectedUid) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Bu e-posta için başka bir kullanıcı kaydı zaten var.",
      );
    }
  }
};

const writeManagedUserDoc = async (uid, payload, existingData = null) => {
  const docData = {
    name: payload.name,
    email: payload.email,
    role: payload.role,
    points: Number(existingData?.points || 0),
    isApproved: payload.isApproved,
    createdAt: existingData?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (payload.role === "student") {
    docData.class = payload.class;
    docData.number = payload.number;
  }

  await db.collection("users").doc(uid).set(docData);
};

const upsertManagedUserRecord = async (payload) => {
  const authUser = await getAuthUserByEmail(payload.email);

  if (!authUser) {
    const createdUser = await admin.auth().createUser({
      email: payload.email,
      password: payload.password,
      displayName: payload.name,
      disabled: false,
    });

    try {
      await writeManagedUserDoc(createdUser.uid, payload);
      await setClaimsForRole(createdUser.uid, payload.role);
    } catch (error) {
      await admin.auth().deleteUser(createdUser.uid).catch(() => null);
      throw error;
    }

    return { ok: true, uid: createdUser.uid, status: "created" };
  }

  await ensureEmailHasNoConflictingDoc(payload.email, authUser.uid);

  const existingDoc = await getUserDoc(authUser.uid);
  if (existingDoc) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Bu e-posta için kullanıcı kaydı zaten mevcut.",
    );
  }

  await admin.auth().updateUser(authUser.uid, {
    password: payload.password,
    displayName: payload.name,
    disabled: false,
  });
  await writeManagedUserDoc(authUser.uid, payload);
  await setClaimsForRole(authUser.uid, payload.role);

  return { ok: true, uid: authUser.uid, status: "repaired" };
};

exports.setUserRole = functions.https.onCall(async (data, context) => {
  await ensureAdmin(context);

  const uid = cleanString(data?.uid);
  const role = cleanString(data?.role);
  if (!uid || !["admin", "teacher", "none"].includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid uid or role.");
  }

  await setClaimsForRole(uid, role === "none" ? "" : role);
  return { ok: true };
});

exports.upsertManagedUser = functions.https.onCall(async (data, context) => {
  await ensureAdmin(context);
  const payload = sanitizeManagedUser(data);
  return upsertManagedUserRecord(payload);
});

exports.bulkUpsertManagedUsers = functions.https.onCall(async (data, context) => {
  await ensureAdmin(context);

  const role = cleanString(data?.role || "student");
  const users = Array.isArray(data?.users) ? data.users : [];
  if (!MANAGED_ROLES.has(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }
  if (!users.length) {
    throw new functions.https.HttpsError("invalid-argument", "No users provided.");
  }
  if (users.length > 300) {
    throw new functions.https.HttpsError("invalid-argument", "Too many users in one request.");
  }

  const results = [];
  for (const rawUser of users) {
    const email = normalizeEmail(rawUser?.email);
    try {
      const payload = sanitizeManagedUser(rawUser, role);
      const result = await upsertManagedUserRecord(payload);
      results.push({ email: payload.email, ok: true, status: result.status, uid: result.uid });
    } catch (error) {
      const message = cleanString(error?.message || error) || "Bilinmeyen hata.";
      results.push({ email, ok: false, message });
    }
  }

  return { ok: true, results };
});

exports.approveManagedUser = functions.https.onCall(async (data, context) => {
  await ensureAdmin(context);

  const uid = cleanString(data?.uid);
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "UID is required.");
  }

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Kullanıcı kaydı bulunamadı.");
  }

  const role = cleanString(snap.data()?.role);
  if (!["student", "teacher", "admin"].includes(role)) {
    throw new functions.https.HttpsError("failed-precondition", "Geçersiz kullanıcı rolü.");
  }

  try {
    await admin.auth().getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Kimlik hesabı bulunamadı. Kullanıcıyı yeniden oluşturun.",
      );
    }
    throw error;
  }

  await userRef.update({
    isApproved: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await setClaimsForRole(uid, role);

  return { ok: true, role };
});

exports.deleteManagedUser = functions.https.onCall(async (data, context) => {
  await ensureAdmin(context);

  const uid = cleanString(data?.uid);
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "UID is required.");
  }

  const userRef = db.collection("users").doc(uid);
  await userRef.delete();

  try {
    await admin.auth().deleteUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  return { ok: true };
});
