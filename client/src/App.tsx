import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import AuthPage from "@/pages/AuthPage";
import { DashboardPage, LibraryPage } from "@/pages/ListPages";
import RecordPage from "@/pages/RecordPage";
import CoursePage from "@/pages/CoursePage";
import SubjectPage from "@/pages/SubjectPage";
import ConsentPage from "@/pages/ConsentPage";
import PrivacyPage from "@/pages/PrivacyPage";
import BillingPage, { QuotaDialog } from "@/pages/BillingPage";

function AppRouter() {
  const { user, ready } = useAuth();
  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Ouverture de ta session…</div>
    );
  if (!user) return <AuthPage />;
  if (!user.aiConsent) return <ConsentPage />;
  return (
    <AppShell>
      <QuotaDialog />
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/record">{() => <RecordPage key="new" />}</Route>
        <Route path="/record/subject/:sid">{(p) => <RecordPage key={`s${p.sid}`} subjectId={Number(p.sid)} />}</Route>
        <Route path="/record/continue/:id">{(p) => <RecordPage key={`c${p.id}`} continueId={Number(p.id)} />}</Route>
        <Route path="/subject/:id">{(p) => <SubjectPage key={p.id} id={Number(p.id)} />}</Route>
        <Route path="/library" component={LibraryPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/abonnement" component={BillingPage} />
        <Route path="/course/:id">{(p) => <CoursePage key={p.id} id={Number(p.id)} />}</Route>
        <Route path="/public/:id">{(p) => <CoursePage key={`p${p.id}`} id={Number(p.id)} publicView />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
