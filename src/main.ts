import "./styles.css";
import { SeatingStore } from "./state/store.js";
import { AppView } from "./ui/render.js";
import { registerWebMcpTools } from "./webmcp/registerTools.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root element");

const store = new SeatingStore();
const view = new AppView(root, store);

void registerWebMcpTools(store).then((status) => {
  view.setWebMcpStatus(status);
  window.addEventListener("beforeunload", status.dispose, { once: true });
});
