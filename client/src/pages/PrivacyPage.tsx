import { useState } from "react";
import { Download, Loader2, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiDownload, apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { DATA_FACTS } from "./ConsentPage";

export default function PrivacyPage() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "withdraw" | "export" | "delete">(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState("");
  const consentDate = user?.aiConsent ? new Date(user.aiConsent.at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;

  async function withdraw() {
    setBusy("withdraw");
    try {
      const r = await apiRequest("DELETE", "/api/consent");
      setUser(await r.json());
    } catch (e: any) {
      toast({ title: "Action impossible", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    setBusy("export");
    try {
      await apiDownload("/api/account/export", "coursscribe-mes-donnees.json");
    } catch (e: any) {
      toast({ title: "Export impossible", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    try {
      await apiRequest("DELETE", "/api/account", { password });
      setAuthToken(null);
      queryClient.clear();
      setUser(null);
    } catch (e: any) {
      toast({ title: "Suppression impossible", description: e.message, variant: "destructive" });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Compte</p>
        <h1 className="mt-1 font-display text-xl font-bold">Confidentialité et données</h1>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#7D4FFE]/10 text-[#7D4FFE]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold" data-testid="text-consent-status">
            Traitement par l'IA accepté{consentDate ? ` le ${consentDate}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Si tu retires ton accord, l'enregistrement, l'import audio et la génération sont bloqués jusqu'à ce que tu l'acceptes de nouveau. Tes cours restent consultables.
          </p>
        </div>
        <Button variant="outline" onClick={() => setConfirmWithdraw(true)} disabled={!!busy} data-testid="button-withdraw-consent">
          <ShieldOff className="mr-2 h-4 w-4" />
          Retirer mon accord
        </Button>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {DATA_FACTS.map((f) => (
          <section key={f.title} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5">
              <f.icon className="h-4 w-4 text-[#7D4FFE]" />
              <h2 className="font-display text-sm font-bold">{f.title}</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
          </section>
        ))}
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Télécharger mes données</h2>
          <p className="mt-1 text-sm text-muted-foreground">Un fichier JSON avec ton compte, tes matières, tes cours, transcriptions, notes, fiches, exercices et examens.</p>
          <Button variant="outline" className="mt-4" onClick={exportData} disabled={!!busy} data-testid="button-export-data">
            {busy === "export" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Télécharger
          </Button>
        </div>
        <div className="rounded-xl border border-[#8A0D1E]/25 bg-card p-5">
          <h2 className="font-display text-base font-bold text-[#8A0D1E]">Supprimer mon compte</h2>
          <p className="mt-1 text-sm text-muted-foreground">Efface définitivement ton compte, tous tes cours (y compris ceux publiés dans la bibliothèque) et leurs fichiers audio.</p>
          <Button variant="outline" className="mt-4 border-[#8A0D1E]/40 text-[#8A0D1E] hover:bg-[#8A0D1E]/5 hover:text-[#8A0D1E]" onClick={() => setConfirmDelete(true)} disabled={!!busy} data-testid="button-delete-account">
            <Trash2 className="mr-2 h-4 w-4" />
            Supprimer mon compte
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ton accord ?</AlertDialogTitle>
            <AlertDialogDescription>Plus aucune donnée ne sera envoyée à l'IA. L'écran d'accord s'affichera de nouveau ; tes cours sont conservés.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={withdraw} data-testid="button-confirm-withdraw">Retirer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => { setConfirmDelete(o); if (!o) setPassword(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer définitivement ton compte ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible. Saisis ton mot de passe pour confirmer.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" className="text-base md:text-sm" data-testid="input-delete-password" />
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteAccount(); }}
              disabled={!password || busy === "delete"}
              className="bg-[#8A0D1E] hover:bg-[#8A0D1E]/90"
              data-testid="button-confirm-delete-account"
            >
              {busy === "delete" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
