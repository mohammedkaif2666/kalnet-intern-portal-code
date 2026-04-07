import { deleteApp, getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const decodeConfigValue = (encoded, secret) => {
  const decoded = atob(encoded);
  let output = "";
  for (let index = 0; index < decoded.length; index += 1) {
    output += String.fromCharCode(decoded.charCodeAt(index) ^ secret.charCodeAt(index % secret.length));
  }
  return output;
};

const secret = "KALNET_SECRET_2026";
const firebaseConfig = {
  apiKey: decodeConfigValue("Cgg2LxYtGzcHGj8hBCt1dHVDCSgpJhY/HDYdMxYDMz1TAwR4HnJ4", secret),
  authDomain: decodeConfigValue("ICAgICAgcjorNzc3OnJCX0BCKi1iKCwmOjEkMDckJC8cU11b", secret),
  projectId: decodeConfigValue("ICAgICAgcjorNzc3OnJCX0BCKi0=", secret),
  storageBucket: decodeConfigValue("ICAgICAgcjorNzc3OnJCX0BCKi1iKCwmOjEkMDc2IDBAUVVTZSA8Pg==", secret),
  messagingSenderId: decodeConfigValue("f3F8fHNha2Rzd2F0", secret),
  appId: decodeConfigValue("ent4fnVmaWZxdGRxZ24IR1dUcSB6fiE2PmByJWB2ZGhTAFYHeyAofSQ=", secret),
};

const mainApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(mainApp);
export const db = getFirestore(mainApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

setPersistence(auth, browserLocalPersistence).catch(() => {
  // Browsers can block persistence in private contexts; auth still works without it.
});

export const ROLE_RECRUITER = "recruiter";
export const ROLE_INTERN = "intern";
export const TICKET_TYPES = {
  meeting_absence: "Meeting absence",
  assignment_delay: "Assignment submission issue",
  website_issue: "Website issue",
};
export const TICKET_STATUS = {
  open: "Open",
  approved: "Approved",
  done: "Done",
};

function isProviderLinked(user, providerId) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === providerId));
}

export function normalizePhone(value) {
  return (value || "").replace(/[^\d+]/g, "");
}

export function normalizePasswordFromPhone(value) {
  return normalizePhone(value);
}

export function inferRole(profile) {
  if (profile?.role === ROLE_RECRUITER || profile?.group === "Recruiter") {
    return ROLE_RECRUITER;
  }
  return ROLE_INTERN;
}

export function getDashboardPath(role) {
  return role === ROLE_RECRUITER ? "recruiter-dashboard.html" : "intern-dashboard.html";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function initials(name) {
  const parts = String(name || "User")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return (parts.map((part) => part[0]).join("") || "U").toUpperCase();
}

export function renderAvatar(url, name, size = 40) {
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name || "User")}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" />`;
  }
  return `<div class="avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.max(12, Math.floor(size / 2.4))}px">${escapeHtml(initials(name))}</div>`;
}

export function formatRelativeTime(timestamp) {
  if (!timestamp?.toDate) {
    return "";
  }
  const seconds = Math.floor((Date.now() - timestamp.toDate().getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  if (!date) {
    return "Not scheduled";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function sortByName(items) {
  return [...items].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export function sortByTimestampDesc(items, key = "timestamp") {
  return [...items].sort((left, right) => {
    const leftTime = left?.[key]?.toDate?.()?.getTime?.() || 0;
    const rightTime = right?.[key]?.toDate?.()?.getTime?.() || 0;
    return rightTime - leftTime;
  });
}

export function normalizeProfile(profile, fallbackUser = null) {
  if (!profile) {
    return null;
  }
  const role = inferRole(profile);
  const email = profile.email || fallbackUser?.email || "";
  return {
    credits: 0,
    github: "",
    group: role === ROLE_RECRUITER ? "Recruiter" : "",
    linkedin: "",
    name: fallbackUser?.displayName || "",
    phone: "",
    photoURL: fallbackUser?.photoURL || "",
    portfolio: "",
    profileComplete: true,
    role,
    showcasePhotos: [],
    uid: fallbackUser?.uid || "",
    ...profile,
    email,
    group: role === ROLE_RECRUITER ? "Recruiter" : profile.group || "",
    role,
    uid: profile.uid || fallbackUser?.uid || "",
  };
}

export function createRecruiterProfilePayload({ user, email, name, phone, existing = {} }) {
  const normalizedPhone = normalizePhone(phone);
  return {
    uid: user.uid,
    email: email.trim(),
    name: (name || user.displayName || existing.name || "Recruiter").trim(),
    phone: normalizedPhone,
    role: ROLE_RECRUITER,
    group: "Recruiter",
    photoURL: existing.photoURL || user.photoURL || "",
    showcasePhotos: existing.showcasePhotos || [],
    github: existing.github || "",
    linkedin: existing.linkedin || "",
    portfolio: existing.portfolio || "",
    credits: existing.credits || 0,
    profileComplete: true,
    joinedAt: existing.joinedAt || serverTimestamp(),
    createdAt: existing.createdAt || serverTimestamp(),
    lastLogin: serverTimestamp(),
  };
}

export async function loadUserProfile(uid, fallbackUser = null) {
  const snapshot = await getDoc(doc(db, "interns", uid));
  if (!snapshot.exists()) {
    return null;
  }
  const profile = normalizeProfile(snapshot.data(), fallbackUser);
  const patch = {};
  if (!snapshot.data().role) patch.role = profile.role;
  if (!snapshot.data().email && profile.email) patch.email = profile.email;
  if (!snapshot.data().uid) patch.uid = uid;
  if (!snapshot.data().group && profile.group) patch.group = profile.group;
  if (Object.keys(patch).length) {
    await setDoc(doc(db, "interns", uid), patch, { merge: true }).catch(() => {});
  }
  return profile;
}

export function waitForAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function requireAuth(options = {}) {
  const {
    profileRedirect = "profile.html",
    redirectTo = "index.html",
    roles = null,
  } = options;

  const user = await waitForAuthState();
  if (!user) {
    window.location.replace(redirectTo);
    return null;
  }

  const profile = await loadUserProfile(user.uid, user);
  if (!profile) {
    window.location.replace(profileRedirect);
    return null;
  }

  if (roles && !roles.includes(profile.role)) {
    window.location.replace(getDashboardPath(profile.role));
    return null;
  }

  return { profile, user };
}

export async function signInWithPortalCredentials(email, password) {
  const normalizedPhonePassword = normalizePasswordFromPhone(password);
  const passwordCandidates = Array.from(new Set([
    String(password ?? ""),
    normalizedPhonePassword,
    normalizedPhonePassword.replace(/^\+/, ""),
    normalizedPhonePassword && !normalizedPhonePassword.startsWith("+") ? `+${normalizedPhonePassword}` : "",
  ].filter(Boolean)));

  let lastError = null;
  for (const candidate of passwordCandidates) {
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), candidate);
      return result.user;
    } catch (error) {
      if (
        error?.code === "auth/invalid-credential" ||
        error?.code === "auth/wrong-password" ||
        error?.code === "auth/invalid-login-credentials"
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Invalid email or password.");
}

export async function signInRecruiterWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const profile = await loadUserProfile(result.user.uid, result.user);
    return {
      status: profile ? "signed_in" : "needs_signup",
      user: result.user,
      profile,
    };
  } catch (error) {
    if (error.code === "auth/account-exists-with-different-credential") {
      const email = error.customData?.email || "";
      const pendingCredential = GoogleAuthProvider.credentialFromError(error);
      const methods = email ? await fetchSignInMethodsForEmail(auth, email).catch(() => []) : [];
      return {
        status: "needs_link",
        email,
        methods,
        pendingCredential,
      };
    }
    throw error;
  }
}

export async function linkGoogleToExistingRecruiter({ email, password, pendingCredential }) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (pendingCredential && !isProviderLinked(result.user, GoogleAuthProvider.PROVIDER_ID)) {
    await linkWithCredential(result.user, pendingCredential).catch((error) => {
      if (error.code !== "auth/provider-already-linked") {
        throw error;
      }
    });
  }
  const profile = await loadUserProfile(result.user.uid, result.user);
  return { user: result.user, profile };
}

export async function signOutUser() {
  await signOut(auth);
}

export async function createRecruiterAccount({ email, name, phone, password }) {
  const normalizedPhone = normalizePhone(phone);
  const finalPassword = password || normalizedPhone;
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), finalPassword);
  await updateProfile(credential.user, { displayName: name }).catch(() => {});
  const profile = createRecruiterProfilePayload({
    user: credential.user,
    email,
    name,
    phone: normalizedPhone,
  });
  await setDoc(doc(db, "interns", credential.user.uid), profile, { merge: true });
  return normalizeProfile(profile, credential.user);
}

export async function completeRecruiterGoogleSignup({ phone, name }) {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error("Google recruiter signup requires an authenticated Google user.");
  }

  const normalizedPhone = normalizePasswordFromPhone(phone);
  if (!normalizedPhone) {
    throw new Error("Phone number is required to link email/password sign-in.");
  }

  if (!isProviderLinked(user, EmailAuthProvider.PROVIDER_ID)) {
    const emailCredential = EmailAuthProvider.credential(user.email, normalizedPhone);
    await linkWithCredential(user, emailCredential).catch((error) => {
      if (error.code !== "auth/provider-already-linked" && error.code !== "auth/credential-already-in-use") {
        throw error;
      }
    });
  }

  const existing = (await loadUserProfile(user.uid, user)) || {};
  if (existing.role && existing.role !== ROLE_RECRUITER) {
    throw new Error("This Google account is already linked to a non-recruiter portal account.");
  }
  const profile = createRecruiterProfilePayload({
    user,
    email: user.email,
    name: name || user.displayName || existing.name || "",
    phone: normalizedPhone,
    existing,
  });
  await setDoc(doc(db, "interns", user.uid), profile, { merge: true });
  return normalizeProfile(profile, user);
}

export async function createInternAccountAsRecruiter(payload, recruiterProfile) {
  const appName = `kalnet-intern-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  const name = payload.name.trim();
  const email = payload.email.trim();
  const group = payload.group;
  const phone = normalizePhone(payload.phone);
  const password = normalizePasswordFromPhone(phone);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await updateProfile(credential.user, { displayName: name }).catch(() => {});
    const profile = {
      uid: credential.user.uid,
      name,
      email,
      phone,
      role: ROLE_INTERN,
      group,
      photoURL: "",
      showcasePhotos: [],
      github: "",
      linkedin: "",
      portfolio: "",
      credits: 0,
      profileComplete: true,
      joinedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
      createdByRecruiterUid: recruiterProfile.uid,
      createdByRecruiterName: recruiterProfile.name,
    };
    await setDoc(doc(db, "interns", credential.user.uid), profile, { merge: true });
    return normalizeProfile(profile, credential.user);
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export async function touchLastLogin(uid) {
  await updateDoc(doc(db, "interns", uid), { lastLogin: serverTimestamp() }).catch(() => {});
}

export async function redirectAuthenticatedUserToDashboard(options = {}) {
  const { missingProfileRedirect = null } = options;
  const user = await waitForAuthState();
  if (!user) {
    return false;
  }
  const profile = await loadUserProfile(user.uid, user);
  if (!profile) {
    if (missingProfileRedirect) {
      window.location.replace(missingProfileRedirect);
      return true;
    }
    return false;
  }
  window.location.replace(getDashboardPath(profile.role));
  return true;
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function stringifyCsvValue(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename, rows) {
  if (!rows.length) {
    return;
  }
  const columns = Object.keys(rows[0]);
  const lines = [
    columns.map(stringifyCsvValue).join(","),
    ...rows.map((row) => columns.map((column) => stringifyCsvValue(row[column])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
