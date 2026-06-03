import {
  initContentScriptMessageListener,
  initExtensionMessageListener,
  initInstalledListener,
  initAlarmListener,
  initSidebarBehavior,
  initSidebarConnectionListener,
  initTransporterBridge,
  initTransporterPush,
} from "background";

function main() {
  initContentScriptMessageListener();
  initExtensionMessageListener();
  initInstalledListener();
  initAlarmListener();
  initSidebarBehavior();
  initSidebarConnectionListener();
  // Register push/notificationclick listeners synchronously on SW boot (before
  // any async work) so a push can revive a terminated worker (manifest §15.3).
  initTransporterPush();
  initTransporterBridge();
}

main();
