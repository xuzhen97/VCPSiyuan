export interface ModalHost {
   host: HTMLElement;
   dispose: () => void;
}

const modalStack: HTMLElement[] = [];

/**
 * Creates the overlay host used by every plugin dialog.
 *
 * All dialogs (task create/edit, task detail, project/label management) mount
 * into one of these. Keeping it in one place means the styling contract
 * (`.vcp-siyuan-modal` + a single panel child) and the dismissal behaviour cannot
 * drift between dialogs.
 *
 * The host owns Escape and backdrop dismissal, and `dispose()` removes both the
 * document listener and the host so neither can leak on unload.
 *
 * Deliberately free of host-API imports so the browser dev sandbox can use the
 * same implementation as the plugin.
 */
export function createModalHost(
   onDismiss: () => void,
   markerClass?: string,
): ModalHost {
   const opener =
      document.activeElement instanceof HTMLElement
         ? document.activeElement
         : null;
   const host = document.createElement("div");
   host.className = markerClass
      ? `vcp-siyuan-modal ${markerClass}`
      : "vcp-siyuan-modal";
   const onKeyDown = (event: KeyboardEvent): void => {
      if (modalStack[modalStack.length - 1] !== host) return;
      if (event.key === "Escape") {
         event.stopPropagation();
         onDismiss();
         return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(host);
      if (focusable.length === 0) return;
      const active = document.activeElement;
      const index = focusable.indexOf(
         active instanceof HTMLElement ? active : focusable[0],
      );
      const nextIndex = event.shiftKey
         ? index <= 0
            ? focusable.length - 1
            : index - 1
         : index < 0 || index === focusable.length - 1
           ? 0
           : index + 1;
      event.preventDefault();
      focusable[nextIndex].focus();
   };
   host.addEventListener("click", (event) => {
      if (event.target === host) onDismiss();
   });
   document.addEventListener("keydown", onKeyDown, true);
   document.body.append(host);
   modalStack.push(host);
   let disposed = false;
   return {
      host,
      dispose: () => {
         if (disposed) return;
         disposed = true;
         document.removeEventListener("keydown", onKeyDown, true);
         const wasTop = modalStack[modalStack.length - 1] === host;
         const index = modalStack.indexOf(host);
         if (index >= 0) modalStack.splice(index, 1);
         host.remove();
         if (wasTop && opener?.isConnected) opener.focus();
      },
   };
}

function getFocusableElements(host: HTMLElement): HTMLElement[] {
   return [
      ...host.querySelectorAll<HTMLElement>(
         "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
   ].filter((element) => {
      return !element.hasAttribute("disabled") && !element.hidden;
   });
}
