const installButtonId = "kalnet-install-button";
let deferredPrompt = null;

function applyInstallButtonLayout(button) {
  const hasChatFab = Boolean(document.getElementById("chat-fab"));
  const isMobile = window.innerWidth <= 768;

  button.style.left = "auto";
  button.style.right = isMobile ? "18px" : "24px";
  button.style.bottom = isMobile ? "18px" : "20px";
  button.style.maxWidth = isMobile ? "calc(100vw - 36px)" : "none";

  if (hasChatFab) {
    button.style.bottom = isMobile ? "92px" : "96px";
  }
}

function injectInstallButton() {
  if (document.getElementById(installButtonId)) {
    return;
  }

  const button = document.createElement("button");
  button.id = installButtonId;
  button.type = "button";
  button.textContent = "Install App";
  button.style.position = "fixed";
  button.style.zIndex = "110";
  button.style.border = "none";
  button.style.borderRadius = "999px";
  button.style.padding = "14px 18px";
  button.style.background = "linear-gradient(135deg, #4f46e5, #7c3aed)";
  button.style.color = "#fff";
  button.style.fontFamily = "Inter, sans-serif";
  button.style.fontSize = "14px";
  button.style.fontWeight = "800";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 16px 36px rgba(79,70,229,.25)";
  button.style.display = "none";

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    button.style.display = "none";
  });

  document.body.appendChild(button);
  applyInstallButtonLayout(button);

  window.addEventListener("resize", () => applyInstallButtonLayout(button));
}

function registerInstallPrompt() {
  injectInstallButton();
  const button = document.getElementById(installButtonId);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    button.style.display = "none";
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    await registration.update().catch(() => {});
  } catch {
    // Keep the site usable even when service worker registration fails.
  }
}

registerInstallPrompt();
registerServiceWorker();
