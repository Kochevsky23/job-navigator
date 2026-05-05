import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { debugLog } from "@/lib/debug";

// Catch unhandled JS errors (e.g. null reference, missing method)
window.onerror = (message, source, lineno, colno, error) => {
  debugLog({
    severity: "error",
    module: "frontend",
    message: String(message),
    error,
    fileName: source ?? undefined,
    rawDetails: { lineno, colno },
  });
};

// Catch unhandled promise rejections (e.g. forgotten await, failed fetch)
window.addEventListener("unhandledrejection", (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  debugLog({
    severity: "error",
    module: "frontend",
    message: `Unhandled promise rejection: ${error.message}`,
    error,
    functionName: "unhandledrejection",
  });
});

createRoot(document.getElementById("root")!).render(<App />);
