# CoursScribe — flux principaux

1. Compte : inscription / connexion (onglets Inscription/Connexion) → tableau de bord.
2. Tableau de bord : cours groupés par matière (vue « Par matière ») ou liste (« Tous les cours »), recherche, « Nouveau chapitre » par matière.
3. Matière (`/subject/:id`) : chapitres numérotés, statut, séances, renommer, supprimer (chapitres conservés).
4. Enregistrement (`/record`, `/record/subject/:sid`) : matière + n° de chapitre suggéré, micro en direct, pause auto 5 min, import audio, sauvegarde auto 15 s.
5. Continuer un cours (`/record/continue/:id`) : nouvelle séance datée, marqueurs « — Séance N · date — ».
6. Micro bloqué (iframe) : panneau « Ouvrir en pleine page » (code de session à usage unique).
7. Cours (`/course/:id`) : séances + audio, statut En cours/Terminé, bannière « analyse à mettre à jour », onglets Notes / Fiche / Exercices / Examen / Transcription, navigation chapitre précédent/suivant.
8. Export PDF / Word / PowerPoint, impression.
9. Publication dans la bibliothèque, consultation publique (`/public/:id`).
10. Examen blanc noté sur 20 (correction IA des questions rédigées).
11. Consentement IA : à la première connexion (ou après retrait), écran obligatoire avec 3 cases (envoi à Google Gemini, 18 ans ou plus, accord de l'enseignant). Sans consentement, l'API renvoie 403 `consent_required` sur transcription, import, génération et correction.
12. Confidentialité (`/privacy`, bouclier dans la barre latérale ou l'en-tête mobile) : retrait du consentement, export JSON des données, suppression du compte (mot de passe demandé, audio compris).
13. Audio des séances : envoyé directement dans le stockage Supabase privé (URL signée), lu via `/api/courses/:id/sessions/:sid/audio` (redirection vers une URL signée temporaire).
14. Import audio long : découpé en morceaux de 4 Mo → fichier temporaire Gemini → transcription par blocs d'1 h → fichier effacé chez Google.
15. Coûts IA : chaque appel est enregistré dans `ai_usage` (jetons d'entrée/sortie, secondes d'audio).
