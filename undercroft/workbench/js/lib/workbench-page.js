import { initAppShell } from "./app-shell.js";
import { DataManager } from "./data-manager.js";
import { resolveApiBase } from "./api.js";
import { initAuthControls } from "./auth-ui.js";
import { initTierVisibility, initTierGate } from "./access.js";
import { initHelpSystem } from "./help.js";
import { initPageLoadingOverlay } from "./loading.js";

function createDataManager(options) {
  const baseUrl = options?.baseUrl ?? resolveApiBase();
  return new DataManager({ ...options, baseUrl });
}

export async function bootstrapWorkbenchPage({
  namespace,
  root = document,
  loadingMessage = "Loading…",
  overlayDelay = 0,
  holdOverlay = true,
  shellOptions = {},
  dataManagerOptions,
  useDataManager = true,
  useAuth = true,
  useHelp = true,
  tierGate,
} = {}) {
  const pageLoading = initPageLoadingOverlay({
    root,
    message: loadingMessage,
    delayMs: overlayDelay,
  });
  const releaseStartup = holdOverlay ? pageLoading.hold() : () => {};
  await pageLoading.nextFrame();

  const shell = initAppShell({ root, namespace, ...shellOptions });
  let dataManager = null;
  if (useDataManager) {
    dataManager = createDataManager(dataManagerOptions);
  }

  let auth = null;
  if (useAuth && dataManager) {
    auth = initAuthControls({ root, status: shell.status, dataManager });
    initTierVisibility({ root, dataManager, status: shell.status, auth });
  }

  const helpReady = useHelp
    ? pageLoading.track(initHelpSystem({ root }))
    : Promise.resolve();

  let gate = null;
  if (tierGate && dataManager) {
    gate = initTierGate({
      root,
      dataManager,
      status: shell.status,
      auth,
      ...tierGate,
    });
  }

  return {
    pageLoading,
    releaseStartup,
    dataManager,
    auth,
    helpReady,
    gate,
    ...shell,
  };
}
