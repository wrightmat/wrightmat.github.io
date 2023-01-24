#location [[Astral Sea]]

```leaflet
id: shardspace-map
image: https://wrightmat.github.io/obsidian/img/Shardspace.png
height: 500px
lat: 50
long: 30
minZoom: 1
maxZoom: 7
defaultZoom: 6
unit: miles
scale: 1
```

Shardspace (also sometimes called Siberspace) is a particularly named wildspace, the empty vacuum between astronomical bodies, inside the world of Eberron. The githyanki, from the second age of Eberron, call it Siberspace, while Aleithilithos, from the original age of Eberron, calls it Shardspace.

The only planet located in Shardspace is Eberron, but that planet rotates around a sun, and has 12 moons that orbit it. There’s also one extraplanetary moon that orbited Eberron at one point.

The 12 moons are separated from the 13th by an expansive void called “The Outer Darkness” (see “In To The Void” adventure), which is the realm of a powerful celestial known as Nyx (or Mother Night).

Continuing through The Outer Darkness, and past Dal Quor, will eventually lead to another silvery-grey void-like space that serves as the edge of Shardspace. Traveling all the way through this silvery-grey space, and piercing a rainbow-y wall of color (Ethereal curtain) leads to the Astral Plane, right at the Rock of Bral.

### Progression and Encounters

As the players progress through their Shardspace adventure, they'll approach each of the moons sequentially when they choose to move forward. At any time they can decide to backtrack though, and return to any previous location. If they decide to do this, then roll a d20 for every week of travel (based on travel times from the table below, rounded up to the nearest whole week):
* On an 18 to 20 then a random encounter occurs (see table below).
* On a 1, they discover the headquarters of the rogue githyanki sect known as The Whisperers, [[14. Susurrus, Palace of Whispers]].

`dice: [[Shardspace#^shardspace-random-encounters]]`

### **Astronomical Bodies**

| Moon | Appearance and Portal Color | Associated Plane | Associated Dragonmark | Distance from Eberron | Travel Time from Eberron |
| --- | --- | --- | --- | --- | --- |
| Zarantyr, the Storm Moon | Pearly white | Kythri | Storm | 14,300 miles | 2 days |
| Olarune, The Sentinel | Pale orange | Lamannia | Sentinel | 22,500 miles | 3.75 days |
| Therendor, The Healer's Moon | Pale gray | Syrania | Healing | 39,000 miles | 6.5 days |
| Eyre, the Anvil | Silver-gray | Fernia | Making | 52,000 miles | 8.6 days |
| Dravago, the Herder's Moon | Pale lavender | Risia | Handling | 77,500 miles | 12.9 days |
| Nymm, the Crown or King Nymm | Pale yellow | Daanvi | Hospitality | 95,000 miles | 15.8 days |
| Lharvion, the Eye | Dull white with black slit | Xoriat | Detection | 125,000 miles | 20.8 days |
| Barrakas, the Lantern | Pale gray | Irian | Finding | 144,000 miles | 24 days |
| Rhaan, the Book | Pale blue | Thelanis | Scribing | 168,000 miles | 28 days |
| Sypheros, the Shadow | Smoky gray | Mabar | Shadow | 193,000 miles | 32 days |
| Aryth, the Gateway | Orange-red | Dolurrh | Passage | 221,000 miles | 36.8 days |
| Vult, the Warding Moon | Gray and pockmarked | Shavarath | Warding | 252,000 miles | 42 days |
| Crya, the Lonely Dreamer | Deep, dark blue | Dal Quor |  | ~400,000 miles | 66.6 days |

### **Random Encounters**

| d100  | Encounter                                                                                                                                                   | Attitude |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 01-05 | `encounter: 1d12: Brown Scavver` swimming in a school                                                                                                       | 0        |
| 06-10 | `encounter: 1d12: Space Eel` swimming in a school                                                                                                           | 0        |
| 11-15 | `encounter: 1d12: Space Guppy` swimming in a school                                                                                                         | 0        |
| 16-20 | `encounter: 1d8: Star Lancer` swimming in a school                                                                                                          | 0        |
| 21-30 | `encounter: 1d8: Space Dolphin` swimming in a pod                                                                                                           | +2       |
| 31-40 | `encounter: 1d8: Kindori` swimming in a pod                                                                                                                 | +2       |
| 41-44 | `encounter: 1d4: Jammer Leech` with any hostile ones successfully attaching to the ship                                                                     | -2       |
| 45    | `encounter: 1: Murder Comet`                                                                                                                                | - 3      |
| 46    | `encounter: 1: Young Solar Dragon`                                                                                                                          | -1       |
| 47    | `encounter: 1: Young Lunar Dragon`                                                                                                                          | - 2      |
| 48    | `encounter: 1: Asteroid Spider`                                                                                                                             | - 3      |
| 49    | `encounter: 1: Living Star`                                                                                                                                 | 0        |
| 50-53 | `encounter: 2d10: Goon Balloon` land on the ship                                                                                                            | - 4      |
| 54-57 | Chest containing 1d100 gp, 2d100 sp, and 3d100 cp, which is actually a `encounter: 1: Mimic` that doesn’t need to breathe air                               | -1       |
| 58-61 | A vast tangle of driftwood, with `encounter: 1d2: Yggdrasti` hiding among it                                                                                | -2       |
| 62-65 | `encounter: 1: Gadabout` who's badly withered but can be nursed back to health with water and a successful DC 12 Intelligence (Nature) check                | +2       |
| 66-70 | A dust cloud reduces visibility to 60 feet for the next 8 hours, roll another encounter                                                                     | -        |
| 71-75 | A gas cloud causes all creatures to become poisoned for the next 8 hours, roll another encounter                                                            | -        |
| 76-80 | Field of scrap metal, 10 percent chance that `encounter: 2d6: Flying Sword, 1: Helmed Horror` hide among it                                                 | -2       |
| 81-85 | `encounter: 2d8: Gas Spore` that don’t need to breathe air                                                                                                  | -2       |
| 86-90 | `encounter: 1: Fractine` reflecting the ship’s appearance back                                                                                              | -4       |
| 91-95 | `encounter: 1: Esthetic`                                                                                                                                    | -2       |
| 96    | Sarcophagus surrounded by permanent black tentacles (as per the spell), with `encounter: 1: Eldritch Lich` inside                                           | -8       |
| 97    | `encounter: 1: Mind Flayer Arcanist, 1: Intellect Devourer` both in magical stasis in a pod with no window. They reactivate when exposed to breathable air. | -8       |
| 98-00 | `dice: [[Shardspace#^shardspace-ship-encounters]]`                                                                                                          |          |
^shardspace-random-encounters

### Ship Encounters

| d100  | Ship Encounter                                                                                                                                                                                                                                                                                                                        | Attitude |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 01-05 | Wasp ship Solitude, captained by Naesala Daerona (astral elf archmage) and crewed by 3 helmed horrors and 3 homunculi                                                                                                                                                                                                                 | - 2      |
| 06-10 | Living ship Eternal Glade, captained by Serissa (human dryad) and crewed by 4 centaurs and Rattlebranch (treant)                                                                                                                                                                                                                      |          |
| 11-17 | Space galleon Mistbreaker, captained by Vael Kan (human assassin) and crewed by 1 mage, 1 acolyte, 4 spies and 10 bandits                                                                                                                                                                                                             | - 2      |
| 18-22 | Bombard Doombellow, captained by Zos Vrek (vampirate) and crewed by 8 vampirates                                                                                                                                                                                                                                                      | - 4      |
| 23-26 | Damselfly ship Truthseeker, captained by Rala Dhendasa (Rakshasa disguised as a human) and crewed by 6 weretigers in human form, with 2 tigers as pets                                                                                                                                                                                | - 4      |
| 27-31 | Scorpion ship Crimson Eye, captained by Krugak son of Gruk (orc war chief) and crewed by 2 orc eyes of Gruumsh, 2 orogs and 7 orcs                                                                                                                                                                                                    | - 6      |
| 32-38 | Hammerhead ship Valor, captained by Ethro Sunstrider (human noble) and crewed by 2 priests, 5 knights and 7 guards                                                                                                                                                                                                                    | + 1      |
| 39-43 | Turtle ship Call of the Wild, captained by Zusk Droknaxl (lizardfolk king/queen) and crewed by 3 lizardfolk shamans and 12 lizardfolk                                                                                                                                                                                                 | - 2      |
| 44-45 | Space galleon Everdawn, captained by Vaerius Argentrock (death knight) and crewed by 3 wights and 15 skeletons                                                                                                                                                                                                                        | - 6      |
| 46-48 | Scorpion ship Bone Collector, captained by Faye Tangleroot (night hag) and crewed by 1 cult fanatic and 8 grimlocks, with 4 giant frogs as pets                                                                                                                                                                                       | - 6      |
| 49-52 | Githyanki Cruiser Northwind, captained by Rak’i’th (githyanki) and crewed by 12 githyanki                                                                                                                                                                                                                                             | - 4      |
| 53-56 | Hammerhead ship Luxury, captained by Bracknell Forest (giff) and crewed by 4 giff and 10                                                                                                                                                                                                                                              |          |
| 57-60 | Squidship Fathomless Deep, captained by Sethek (sahuagin baron) and crewed by 2 sahuagin priestesses and 10 sahuagin                                                                                                                                                                                                                  | - 4      |
| 61-66 | Wasp ship Problemsolver, crewed by an adventuring party that includes captain Devon Tharias (human veteran), 1 berserker, 1 priest, 1 mage and 1 spy                                                                                                                                                                                  | - 2      |
| 67-71 | Flying fish ship Fishbait with a crew of fishers. Captained by Barask ‘One-Eyed’ (half-orc veteran) and crewed by 2 acolytes, 2 scouts and 5 commoner sailors                                                                                                                                                                         |          |
| 72-76 | Bombard Moradin’s Hammer, captained by Argor Stonemight (dwarf gladiator) and crewed by 2 dwarf priests, 4 dwarf veterans and 5 dwarf guards                                                                                                                                                                                          |          |
| 77-80 | Star moth Silkweaver, captained by Zarvyll Myval (drow priestess) and crewed by 1 drow mage, 2 drow elite warriors and 8 drow, with 4 giant spiders as pets                                                                                                                                                                           | - 2      |
| 81-83 | Lamprey ship Endless Night, captained by Szatszothi (yuan-ti abomination) and crewed by 4 yuan-ti malisons and 8 cultists, with 4 giant poisonous snakes as pets                                                                                                                                                                      | - 4      |
| 84-87 | Flying fish ship Ctha-dak’s Mandible, captained by Glak-nuk (thri-kreen mystic) and crewed by 4 thri-kreen hunters and 5 thri-kreen                                                                                                                                                                                                   | - 1      |
| 88-92 | Damselfly ship Fortune, captained by Xzav Khel (mercane) and crewed by 2 mercanes and 5 plasmoid warriors                                                                                                                                                                                                                             | + 2      |
| 93-96 | Shrike ship Beak of Destiny, captained by Ookel Khur (dohvar) and crewed by 2 giff shock troopers and 5 dohvars, with 5 space swine pets (used as mounts by the dohvar)                                                                                                                                                               | + 2      |
| 97-98 | Squid ship Gallant Glee, filled with musical instruments, bottles, goblets, and other festive objects, but also a dozen humanoid corpses. The corpses are the previous victims of 11 space clowns (including captain Jovial Jek) that use their Phantasmal Form to appear as the festive objects, attacking if their ship is boarded. | - 8      |
| 99-00 | Nightspider Conquest, crewed by 25 clockwork horrors                                                                                                                                                                                                                                                                                  | - 4      |
^shardspace-ship-encounters

### References
[https://www.reddit.com/r/Eberron/comments/xo4fwd/map_of_eberrons_moons_and_time_to_travel_both/](https://www.reddit.com/r/Eberron/comments/xo4fwd/map_of_eberrons_moons_and_time_to_travel_both/)
