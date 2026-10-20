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
| Variateur (Dimmer 2, Walli Dimmer…)                                   | une lumière (marche/arrêt, luminosité) s'il pilote une lampe, sinon un variateur |
| Module RGBW                                                           | une lumière : marche/arrêt, luminosité, couleur                                  |
| Volet roulant (Roller Shutter 2/3, Walli Roller Shutter)              | un volet : position, ouvrir, fermer, stop                                        |
| Volet sans position                                                   | ouvrir, fermer, stop                                                             |
| Tête thermostatique, thermostat, climatisation                        | un thermostat : consigne, mode (arrêt, chauffage, froid, auto), état de chauffe  |
| Serrure                                                               | une serrure : verrouiller toujours ; déverrouiller seulement avec l'option       |
| Portail, porte de garage, porte motorisée (barrier, rôle Portail)     | son état, et des boutons Ouvrir, Fermer, Stop ; Ouvrir seulement avec l'option   |
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
fonctionne à l'inverse, Ouvrir et Fermer sont inversés. Un portail piloté
par un module de volet reste un volet pour Gladys : réglez son rôle sur Portail
ou Porte de garage dans la box. Jamais testé sur un vrai portail, une vraie
serrure ni une vraie vanne.

**Après la mise à jour depuis 0.1.1.** Les appareils déjà ajoutés gardent
leurs fonctions, mais une commande d'ouverture, de déverrouillage ou de vanne
est refusée tant que l'option correspondante est désactivée : les scènes 0.1.1
qui ouvraient un portail, déverrouillaient une serrure ou pilotaient une vanne
échouent alors avec ce message. Un volet ajouté en 0.1.1 comme interrupteur ou
variateur apparaît dans Découverte avec « Mettre à jour » : ce bouton remplace
ses fonctions Marche/arrêt et Niveau par Position et Ouvrir/fermer, et leur
historique est supprimé. Un portail ajouté en 0.1.1 comme volet garde ses
fonctions volet, avec la même règle ; un portail ajouté comme interrupteur
perd cette fonction (et son historique) à la mise à jour. Une vanne ajoutée
en 0.1.1 comme interrupteur garde sa fonction Marche/arrêt et son historique,
mais en lecture seule : seuls les boutons Ouvrir et Fermer pilotent la vanne,
et les scènes 0.1.1 qui utilisaient cet interrupteur doivent passer à ces
boutons.

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
