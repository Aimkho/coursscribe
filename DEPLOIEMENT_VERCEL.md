# Mettre CoursScribe en ligne sur Vercel

Tout est déjà configuré dans le code (`vercel.json` + `script/build-vercel.ts`) : Vercel construit l'application React et une fonction serveur `/api` qui contient toute l'API (comptes, cours, IA, exports PDF/Word/PowerPoint).

## 1. Avant de commencer

- **Clé Gemini** : sur [Google AI Studio](https://aistudio.google.com/apikey), crée la clé dans un projet Google Cloud **avec la facturation activée**. Les conditions de Google imposent l'offre payante pour servir des utilisateurs de l'Union européenne.
- **Plafond de dépenses** : dans Google Cloud > Facturation > Budgets et alertes, crée un budget (ex. 10 €) avec alertes à 50 %, 90 % et 100 %.
- **Mot de passe de la base** : celui du rôle `coursscribe_app` (fichier `.env.db` en local, jamais publié).
- **Plan Vercel** : le plan gratuit Hobby est réservé à un usage non commercial. Dès que l'abonnement payant est activé, passe en Pro.

## 2. Importer le projet

1. Pousse le dossier sur un dépôt GitHub **privé**.
2. Vercel > Add New > Project > importe le dépôt.
3. Ne change rien dans « Build & Output Settings » : `vercel.json` fixe déjà l'installation (`npm ci --include=dev`), la construction (`npm run build:vercel`) et le dossier de sortie (`.vercel/output`).
4. Settings > General > Node.js Version : **22.x**.

## 3. Variables d'environnement

Settings > Environment Variables (Production et Preview) :

| Nom | Valeur |
|---|---|
| `GEMINI_API_KEY` | ta clé Gemini |
| `DATABASE_URL` | `postgresql://coursscribe_app.rxlujvkutaaprcdnbqdj:MOT_DE_PASSE@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | `https://rxlujvkutaaprcdnbqdj.supabase.co` |
| `GEMINI_TEXT_MODEL` (facultatif) | `gemini-3.5-flash-lite` |
| `GEMINI_STT_MODEL` (facultatif) | `gemini-3.5-flash-lite` |

Le port **6543** (Transaction pooler) est indispensable : chaque appel Vercel ouvre une nouvelle connexion.

Puis Deployments > Redeploy.

## 4. Vérifier

- `https://ton-domaine/` : la page de connexion s'affiche.
- Crée un compte : l'écran de consentement IA apparaît avant le premier cours.
- Enregistre 30 secondes : le texte arrive environ toutes les 20 secondes.
- Exporte un cours en PDF.
- Consommation IA : table `ai_usage` dans Supabase (jetons par utilisateur et par action).

## 5. Nom de domaine

Settings > Domains > ajoute ton domaine (ex. `coursscribe.fr`). Le micro ne fonctionne qu'en HTTPS, ce que Vercel fournit automatiquement.

## Limites connues

- Fonction limitée à 300 s par appel : l'import audio est découpé en morceaux de 4 Mo et la transcription se fait par blocs d'1 h, ce qui reste en dessous.
- Fichier importé : 500 Mo maximum.
