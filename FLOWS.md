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
