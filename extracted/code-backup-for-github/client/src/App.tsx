import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import RoleSelection from "@/pages/role-selection";
import RoomSelection from "@/pages/room-selection";
import RoomDisplay from "@/pages/room-display";
import TrainerDashboard from "@/pages/trainer-dashboard";
import EquipmentView from "@/pages/equipment-view";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={RoleSelection} />
      <Route path="/rooms" component={RoomSelection} />
      <Route path="/room/:id" component={RoomDisplay} />
      <Route path="/admin" component={TrainerDashboard} />
      <Route path="/equipment" component={EquipmentView} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
