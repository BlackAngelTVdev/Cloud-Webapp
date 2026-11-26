# Cloud-Webapp
## Problème
**Automatisation du start** : le champ de notification est noté comme non obligatoire, mais bloque la création sans nous en notifier.  
solution : j'ai mis la notif.

**Automatisation du stop** : le champ de l'heure de start est pas valide mais valide.  
solution : changer la TimeZone de UTC vers W. Europe Standard Time (solution trouvé par le professeurs).

**npm i** : la vm ne voulais pas.  
solution : j'ai pas installer comme ca mais avec npm ci --omit=dev.

**Azure** : on n'as mal lue je cdc donc on a commancer le projet avec une vm qui ne nous permais pas de finir le projet  
solution : on recommence avec un Paas comme demande dans le CDC.

**Infra** : le téléphone de Mr.Ruberti c'est cassé donc le 26.11.2026 il n'a pas pue se connécté a azure.  
solution : pour fare la Paas Mr.Rochat a fork le projet pour link Github et Azure.

**Déployement du PaaS** : quand on allais sur le site jdjp-dtbmafa8exava5aj.switzerlandnorth-01.azurewebsites.net il mettais une erreur 503(Service Unavailable), 504(Gateway Timeout) car le workflow de github ne pouvais pas déployer sur azure le programme.  
solution : on avais oublier les variable d'environement