import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import Dashboard from "@/pages/Dashboard";
import Conversations from "@/pages/Conversations";
import ConversationDetail from "@/pages/ConversationDetail";
import Recommendations from "@/pages/Recommendations";
import Ingest from "@/pages/Ingest";
import Report from "@/pages/Report";
import Copilot from "@/pages/Copilot";
import Merchants from "@/pages/Merchants";
import MerchantDetail from "@/pages/MerchantDetail";
import Business from "@/pages/Business";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/conversations" component={Conversations} />
      <Route path="/conversations/:id" component={ConversationDetail} />
      <Route path="/recommendations" component={Recommendations} />
      <Route path="/ingest" component={Ingest} />
      <Route path="/report" component={Report} />
      <Route path="/copilot" component={Copilot} />
      <Route path="/merchants" component={Merchants} />
      <Route path="/merchants/:id" component={MerchantDetail} />
      <Route path="/business" component={Business} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
