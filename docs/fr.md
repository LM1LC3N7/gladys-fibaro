# Fibaro / Yubii Home

Cette intégration relie Gladys à **votre Fibaro Home Center 2, Home Center
Lite, Home Center 3, HC3 Lite ou Nice Yubii Home** et propose les appareils de
la box dans l'onglet **Découverte** de Gladys : interrupteurs, variateurs,
modules RGBW, volets roulants, thermostats, serrures et capteurs. Une fois un
appareil ajouté, ses états suivent la box en direct, et Gladys le pilote **à
travers la box**, qui continue de tourner : votre réseau Z-Wave, vos scènes
Fibaro et votre application Yubii restent tels quels. Les télécommandes et
boutons poussoirs deviennent des **déclencheurs de scène**, et une action de
scène lance une **scène Fibaro**. Non officiel, sans lien avec Fibaro ou Nice.

> **Version de développement (0.1).** Écrite d'après la documentation de l'API
> et des exports de vraies box, pas encore testée sur un vrai Home Center ou
> une vraie Yubii Home. Vos retours sont les bienvenus sur le dépôt GitHub.

## Mise en route

1. Trouvez l'adresse IP de la box (dans son interface web, ou dans votre box
   internet). Donnez-lui une adresse fixe dans votre box internet.
2. Dans Gladys, ouvrez **Intégrations → Fibaro / Yubii Home → Configuration**
   et saisissez :
   - l'**adresse** : `http://192.168.1.50` (une adresse IP seule vaut
     `http://`). Un HC3 ou une Yubii Home en HTTPS uniquement : `https://…`,
     et désactivez **Vérifier le certificat TLS** (leur certificat est
     auto-signé) ;
   - le **nom d'utilisateur** et le **mot de passe** de connexion à la box
     (`admin` sur un Home Center 2, souvent une adresse e-mail sur un HC3 ou
     une Yubii Home). Un compte administrateur voit tous les appareils ; un
     compte utilisateur seulement ceux qui lui ont été attribués.
3. Cliquez sur **Tester la connexion** : le modèle, son firmware et le nombre
   d'appareils proposés s'affichent sous le bouton.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

## Ce que vous obtenez

| Dans la box                                                           | Dans Gladys                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Relais, prise murale (interrupteur)                                   | un interrupteur, avec sa puissance et son énergie quand il les mesure            |
| Relais d'une lampe (rôle Lumière, Lampe de jardin, Applique…)         | une lumière marche/arrêt, avec sa puissance et son énergie                       |
| Variateur (Dimmer 2, Walli Dimmer…)                                   | une lumière (marche/arrêt, luminosité) s'il pilote une lampe, sinon un variateur |
| Module RGBW                                                           | une lumière : marche/arrêt, luminosité, couleur                                  |
| Volet roulant (Roller Shutter 2/3, Walli Roller Shutter)              | un volet : position, ouvrir, fermer, stop                                        |
| Volet sans position                                                   | ouvrir, fermer, stop                                                             |
| Tête thermostatique, thermostat, climatisation                        | un thermostat : consigne, mode (arrêt, chauffage, froid, auto), état de chauffe  |
| Serrure                                                               | une serrure : verrouiller toujours ; déverrouiller seulement avec l'option       |
| Portail, porte de garage, porte motorisée (voir ci-dessous)           | son état, et des boutons Ouvrir, Fermer, Stop ; Ouvrir seulement avec l'option   |
| Portail sur un relais (rôle Portail ou Porte de garage)               | le contact du relais, et un bouton Ouvrir (impulsion) seulement avec l'option    |
| Vanne d'eau ou de gaz (type valve, rôle Vanne)                        | son état, et des boutons Ouvrir et Fermer, tous deux seulement avec l'option     |
| Capteur d'ouverture, de mouvement, d'inondation, de fumée, de CO      | le capteur Gladys correspondant                                                  |
| Capteurs de température, luminosité, humidité, puissance, énergie     | le capteur Gladys correspondant                                                  |
| Niveau de pile                                                        | une fonctionnalité batterie                                                      |
| Télécommande, bouton poussoir, entrées S1/S2 avec activation de scène | un bouton par touche, et le déclencheur « Télécommande ou bouton Fibaro »        |

Chaque appareil porte le nom de sa pièce, comme dans la box : `Prise murale
(Salon)`. Écartés : les appareils désactivés et masqués, les utilisateurs et
téléphones de la box, et les appareils des plugins (HC2) et Quick Apps (HC3),
sauf si vous activez **Proposer aussi les plugins et Quick Apps**.

**Ouverture, déverrouillage et vannes désactivés par défaut.** Gladys ferme et
arrête un portail, une porte de garage ou une porte motorisée, et verrouille
une serrure, mais ne les ouvre ni ne les déverrouille tant que vous n'avez pas
coché **Autoriser l'ouverture des portails, portes de garage et portes**
(`allow_gates`) ou **Autoriser le déverrouillage des serrures**
(`allow_unlock`). Une vanne d'eau ou de gaz n'est ni ouverte ni fermée
(ouvrir peut inonder, fermer coupe l'eau) tant que **Autoriser l'ouverture et
la fermeture des vannes** (`allow_valves`) n'est pas coché. Sinon la commande
est refusée avec un message, sans rien envoyer. Une fois l'option cochée,
Gladys relit l'état de l'appareil dans la box juste avant : elle refuse si
l'état est inconnu ou si l'appareil est signalé mort, et n'envoie rien s'il est
déjà clairement ouvert (ou déverrouillé, ou dans l'état demandé pour une
vanne). Un Stop, un Fermer ou un Verrouiller part tout de suite et annule une
ouverture ou un déverrouillage encore en attente. Un portail piloté par un
simple relais n'a qu'un bouton Ouvrir (une impulsion) : Gladys ne peut pas
savoir s'il est ouvert, elle vérifie seulement qu'il répond. Sur un portail à
commande pas à pas, cette impulsion peut aussi l'arrêter ou le fermer ; le
relais doit être réglé en mode impulsion dans la box. Pour une vanne sur un
relais, « relais activé » est lu comme « vanne ouverte » : si votre vanne
fonctionne à l'inverse, Ouvrir et Fermer sont inversés. Jamais testé sur un
vrai portail, une vraie serrure ni une vraie vanne.

**Comment Gladys reconnaît un portail.** Un appareil est un portail (jamais un
volet, un interrupteur ni un variateur, donc jamais atteint par « fermer les
volets », « tout éteindre » ou une scène qui ouvre les volets) quand :

- son type contient barrier, gate, garage ou door ;
- l'identifiant de son rôle dans la box contient Gate, Garage, Door, Barrier
  ou Portal (`Gate`, `GarageDoor`, `SlidingGate`…), ou il est dans la
  catégorie `gates` d'un HC3 ou d'une Yubii Home ;
- c'est un module de volet (ou un moteur radio) dont le nom contient garage,
  garaje, portail, portillon, barrière, porte sectionnelle, porte basculante,
  cancello, portón, portão, poort, garagedeur, le mot gate ou le mot Tor, ou
  un composé en -tor (Rolltor, Hoftor, Einfahrtstor…). Dans le doute, Gladys
  choisit le portail (ouverture gardée par l'option) : un « Volet garage » est
  donc un portail. Exception : un nom avec fenêtre, velux, window ou Fenster
  reste un volet ;
- c'est un simple relais, sans rôle ni catégorie de lampe, dont le nom
  **commence** par le portail (« Portail », « Portail entrée », « Porte de
  garage », « Hoftor »…, ou exactement « Garage », avec au plus un numéro ou
  un côté : « Garage 2 », « Garage gauche » ; « Garage sirène » reste un
  interrupteur) et ne contient aucun mot d'appareil
  (chauffage, radiateur, congélateur, frigo, pompe, ventilation, interphone,
  sonnette, ballon, lave, sèche, arrosage, prise, lumière, éclairage, lampe,
  light…) : « Chauffage garage » ou « Pompe portail » restent des
  interrupteurs.

Une serrure ou une vanne reste une serrure ou une vanne, quel que soit son
nom.

Si votre portail apparaît encore comme volet, donnez-lui le rôle Portail
(`Gate`) ou Porte de garage (`GarageDoor`) dans la box, ou un nom qui contient
« Portail ». Si un **volet de fenêtre** devient un portail parce que son nom
contient « garage », renommez-le dans la box (par exemple « Volet fenêtre
garage »). Un moteur de portail qui ne peut pas avoir de position et ne
remonte ni valeur ni état (moteur radio sans retour) s'ouvre, une fois
l'option cochée, si la box dit qu'il répond, comme un portail sur relais ; un
portail qui a une valeur ou un état inconnu n'est jamais ouvert. Un capteur de
portail, une serrure ou une sonnette ne sont jamais des portails.

**Après la mise à jour depuis 0.1.1.** Les appareils déjà ajoutés gardent
leurs fonctions, mais une commande d'ouverture, de déverrouillage ou de vanne
est refusée tant que l'option correspondante est désactivée : les scènes 0.1.1
qui ouvraient un portail, déverrouillaient une serrure ou pilotaient une vanne
échouent alors avec ce message. Un volet ajouté en 0.1.1 comme interrupteur ou
variateur apparaît dans Découverte avec « Mettre à jour » : ce bouton remplace
ses fonctions Marche/arrêt et Niveau par Position et Ouvrir/fermer, et leur
historique est supprimé. Un portail ajouté comme interrupteur perd cette
fonction (et son historique) à la mise à jour. Une vanne ajoutée
en 0.1.1 comme interrupteur garde sa fonction Marche/arrêt et son historique,
mais en lecture seule : seuls les boutons Ouvrir et Fermer pilotent la vanne,
et les scènes 0.1.1 qui utilisaient cet interrupteur doivent passer à ces
boutons.

**Après la mise à jour vers 0.1.3.** Les identifiants des appareils ne
changent pas, mais certains changent de catégorie ; ouvrez **Découverte** et
cliquez sur **Mettre à jour** sur ces appareils :

- un **portail** ajouté comme volet (« État du volet », « Position ») devient
  un portail : son état et les boutons Ouvrir, Fermer, Stop. Jusqu'à la mise
  à jour, ses anciennes fonctions volet peuvent seulement le **fermer ou
  l'arrêter** (Position 0 ferme) ; toute ouverture est refusée sans rien
  envoyer, avec un message qui renvoie à Découverte → Mettre à jour.
  « Mettre à jour » supprime ces fonctions volet avec leur historique ;
  refaites les scènes qui les utilisaient avec les nouveaux boutons ;
- un **relais de lampe** ajouté comme interrupteur devient une lumière : la
  fonction Marche/arrêt change de catégorie à la mise à jour et garde son
  historique (même identifiant) ;
- un **relais nommé comme un portail** (« Portail ») devient un portail sur
  relais. Jusqu'à la mise à jour, son ancienne fonction Marche/arrêt peut
  seulement l'**éteindre** ; l'allumer (l'impulsion d'ouverture) est refusé
  avec un message qui renvoie à Mettre à jour. La mise à jour retire cet
  interrupteur, avec son historique ;
- une **lumière cachée** de la box dont seuls les boutons S1/S2 étaient
  proposés apparaît comme un nouvel appareil (à ajouter) ; l'appareil
  « boutons » déjà ajouté ne change pas (il peut s'appeler « <nom> S1/S2 »
  dans Découverte). Une sortie que vous avez masquée vous-même dans la box,
  sur un module dont les entrées S1/S2 sont proposées, apparaît aussi dans
  Découverte : rien n'est créé tant que vous ne l'ajoutez pas, ignorez-la.

Un appareil que la box signale comme **mort** (il ne répond plus : pile,
portée, alimentation) garde un badge avec un point orange dans Gladys jusqu'à
ce qu'il réponde à nouveau.

## Télécommandes et boutons dans les scènes

Une touche d'une télécommande (KeyFob), d'un bouton poussoir (The Button) ou
l'entrée S1/S2 d'un interrupteur, variateur ou module volet Fibaro avec
l'activation de scène envoie un événement de **scène centrale**. Deux façons
de s'en servir :

- la fonctionnalité **bouton** de l'appareil (une par touche) change à chaque
  appui : « clic », « double clic », « triple clic », « maintenu », « relâché » ;
- le déclencheur de scène **Télécommande ou bouton Fibaro** : choisissez la
  télécommande, le numéro de la touche et le geste. Ses variables donnent la
  touche, le geste et l'attribut envoyé par la box (`Pressed`, `Pressed2`,
  `HeldDown`, `Released`…).

Les touches S1/S2 n'envoient d'événements que si l'**activation de scène** est
activée dans les paramètres du module (paramètre 28 d'un Dimmer 2 ; voir le
manuel des autres).

## Lancer une scène Fibaro

Cliquez sur **Lister les scènes Fibaro** dans la configuration : le numéro de
chaque scène visible s'affiche sous le bouton. Dans une scène Gladys, ajoutez
l'action **Lancer une scène Fibaro** et saisissez le numéro. Les scènes
protégées par un code PIN ne peuvent pas être lancées ainsi.

## Bon à savoir

- **Temps réel** : Gladys garde une requête ouverte avec la box
  (`/api/refreshStates`), qui répond dès que quelque chose change.
- **Mesures** : une prise murale peut remonter sa puissance toutes les
  quelques secondes. Gladys garde la dernière mesure toutes les **Intervalle
  minimum entre deux mesures d'un capteur** (10 s par défaut) ; interrupteurs,
  boutons et détecteurs d'ouverture ou de mouvement ne sont jamais retardés.
- **Changements dans la box** (un appareil ajouté, renommé, déplacé) : Gladys
  relit la liste en quelques secondes ; cliquez sur **Scanner** dans
  Découverte pour forcer.
- La box bloque une adresse après **plusieurs échecs de connexion** : après
  une erreur de mot de passe, Gladys ne réessaie que toutes les 5 minutes.

## Dépannage

- **« a refusé le nom d'utilisateur ou le mot de passe »** : saisissez-les à
  nouveau ; essayez-les dans l'interface web de la box.
- **« certificate refused »** : désactivez **Vérifier le certificat TLS**, ou
  utilisez `http://`.
- **« injoignable »** : utilisez l'adresse IP de la box sur le réseau local
  (pas `localhost`, pas une adresse d'accès à distance), et vérifiez que la
  machine Gladys la joint.
- **Un appareil manque** : est-il activé et visible dans la box ? Est-ce un
  plugin ou une Quick App (activez l'option) ? Cliquez sur **Tester la
  connexion** : le message compte les appareils écartés et pourquoi, et donne
  le type Fibaro de ceux qui n'ont rien à proposer (à indiquer dans un
  ticket). Les « nœuds techniques » qu'il cite sont normaux : un module Z-Wave
  a un nœud parent caché dans la box, ses sous-appareils sont les appareils
  proposés.
- **Un volet** est toujours un volet dans Gladys (position, ouvrir, fermer,
  stop), jamais un interrupteur. Les boutons S1/S2 d'un module volet avec
  activation de scène apparaissent en plus comme fonctions « bouton » en
  lecture seule : ils servent de déclencheurs de scène, pas à piloter le volet.
- **Une lumière n'apparaît qu'en « Clic bouton »** : sur un module dont la box
  cache le relais, seules les entrées S1/S2 étaient proposées. Depuis 0.1.3 le
  relais est proposé à part, comme lumière (ou interrupteur si son rôle dans
  la box n'est pas une lampe) ; l'appareil boutons reste un déclencheur.

## Envoyer la liste de vos appareils (pour un ticket)

Si un appareil est mal reconnu, la liste de la box permet de corriger
l'intégration :

1. Dans un navigateur connecté à la box (ouvrez d'abord son interface web),
   ouvrez `http://<ip-de-la-box>/api/devices` : c'est la **liste complète**,
   sans numéro à la fin.
2. Cherchez (Ctrl+F) le nom de l'appareil, ou mieux son numéro : dans Gladys,
   **Paramètres techniques** de l'appareil → `FIBARO_ID`, puis cherchez
   `"id": <ce numéro>` (ou `"id":<ce numéro>`).
3. Copiez le bloc de l'appareil (de `{"id": …` jusqu'à l'accolade fermante
   correspondante), puis celui de son parent : le numéro donné par son
   `parentId` ; et les blocs qui ont le même `parentId` (les autres canaux du
   module).
4. Vérifiez qu'aucune donnée personnelle n'y figure (noms, adresses, e-mails,
   coordonnées GPS : remplacez-les par `xxx`) ; il n'y a pas de mot de passe
   dans cette liste. Collez-les dans le ticket GitHub (ou dans un gist).

**Pourquoi `/api/devices/<numéro>` répond « introuvable ».** Causes possibles
(non vérifiées sur une Yubii Home) :

- le numéro saisi n'est pas l'identifiant Fibaro : il faut le nombre seul de
  `FIBARO_ID`, pas l'identifiant externe de Gladys (`fibaro:123`, ou avec le
  préfixe `ext:…`), ni le numéro d'un appareil de Gladys ;
- le numéro vient de l'application Yubii ou de l'adresse d'une page de
  l'interface web : il peut désigner un autre appareil (le module visible)
  que celui que Gladys propose. Ainsi, l'appareil « boutons S1/S2 » est dans
  la box un appareil caché nommé comme `175.0.1`, que Gladys appelle du nom
  de son module : le chercher par son nom dans la liste ne le trouve pas,
  cherchez son numéro ;
- l'appareil a été réinclus dans la box depuis (il a un nouveau numéro).

La liste complète `/api/devices` contourne ces trois cas.
