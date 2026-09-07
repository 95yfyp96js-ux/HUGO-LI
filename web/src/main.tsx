import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { IS_SNAPSHOT } from "./lib/snapshot";
import { App } from "./App";
import "./index.css";

// The static preview is served as a single file with no server-side routing,
// so it uses hash routing; the real app uses clean paths.
const Router = IS_SNAPSHOT ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>
);
