import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import EditorPage from "./pages/EditorPage.tsx";
import AdminConfigs from "./pages/AdminConfigs.tsx";
import DesignerPage from "./pages/admin/DesignerPage.tsx";
import AnalyticsPage from "./pages/admin/AnalyticsPage.tsx";
import { RequireAdmin } from "./components/admin/RequireAdmin.tsx";

import { useCartSync } from "./hooks/useCartSync";
import { useShopContextBootstrap } from "./hooks/useShopContextBootstrap";

const queryClient = new QueryClient();

const AppRoutes = () => {
  useCartSync();
  useShopContextBootstrap();
  return (
    <Routes>
      {/* Kundvända sidor — aldrig grindade. */}
      <Route path="/home" element={<Index />} />
      <Route path="/editor" element={<EditorPage />} />
      {/* Adminsidor — kräver inloggad admin (RequireAdmin). */}
      <Route path="/" element={<RequireAdmin><AdminConfigs /></RequireAdmin>} />
      <Route path="/admin/configs" element={<RequireAdmin><AdminConfigs /></RequireAdmin>} />
      <Route path="/admin/designer/:handle" element={<RequireAdmin><DesignerPage /></RequireAdmin>} />
      <Route path="/admin/analytics" element={<RequireAdmin><AnalyticsPage /></RequireAdmin>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
