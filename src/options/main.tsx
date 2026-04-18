import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OptionsApp from "./OptionsApp";
import "../sidepanel/index.css";

document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
