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

The moons are separated in to "inner moons", those first six overseen by the Sovereign Host and Dark Six, and "outer moons", those last seven (plus the Outer Darkness) ruled by The Endless. While there is little practical difference between the moons/planes (unlike the inner and outer planes of the Forgotten Realms), these moons' rulers are different. The Sovereign Host are considered gods because they generally require worship in order to remain relevant. But the Endless are truly eternal and don't require worship at all - they will continue to rule the realms given to them by their mother regardless of what mortals think of them (although their realms can also continue to function without their presence).

The 12 moons are separated from the 13th by an expansive void called “The Outer Darkness” (see “In To The Void” adventure), which is the realm of a powerful celestial known as Entropy (or Mother Night).

Continuing through The Outer Darkness, and past Dal Quor, will eventually lead to another silvery-grey void-like space that serves as the edge of Shardspace. Traveling all the way through this silvery-grey space, and piercing a rainbow-y wall of color (Ethereal curtain) leads to the Astral Plane, right at the Rock of Bral.

### Progression and Encounters

As the players progress through their Shardspace adventure, they'll approach each of the moons sequentially when they choose to move forward.
* Roll for a random encounter once, based on a "lower danger environment" (occurring on 20+).
At any time they can decide to backtrack though, and return to any previous location.
* Roll a random encounter for every week of travel, based on a "higher danger environment" (occurring on 18+, travel times from the table below rounded up to the nearest whole week).

`dice: [[Shardspace#^shardspace-random-encounters]]`

### Astronomical Bodies

[[14. Susurrus, Palace of Whispers]] is located exactly halfway between Barrakas and Rhaan, after it was randomly encountered after leaving Barrakas.

| d12 | Moon                     | Appearance and Portal Color | Associated Plane | Assoc. Dragonmark | Distance from Eberron | Travel Time from Eberron |
| --- | ------------------------ | --------------------------- | ---------------- | ----------------- | --------------------- | ------------------------ |
| 1   | Zarantyr, the Storm Moon | Pearly white                | Kythri           | Storm             | 14,300 miles          | 2 days                   |
| 2   | Olarune, The Sentinel    | Pale orange                 | Lamannia         | Sentinel          | 22,500 miles          | 3.75 days                |
| 3   | Therendor, The Healer    | Pale gray                   | Syrania          | Healing           | 39,000 miles          | 6.5 days                 |
| 4   | Eyre, the Anvil          | Silver-gray                 | Fernia           | Making            | 52,000 miles          | 8.6 days                 |
| 5   | Dravago, the Herder      | Pale lavender               | Risia            | Handling          | 77,500 miles          | 12.9 days                |
| 6   | Nymm, the Crown          | Pale yellow                 | Daanvi           | Hospitality       | 95,000 miles          | 15.8 days                |
| 7   | Lharvion, the Eye        | Dull white with black slit  | Xoriat           | Detection         | 125,000 miles         | 20.8 days                |
| 8   | Barrakas, the Lantern    | Pale gray                   | Irian            | Finding           | 144,000 miles         | 24 days                  |
| 9   | Rhaan, the Book          | Pale blue                   | Thelanis         | Scribing          | 168,000 miles         | 28 days                  |
| 10  | Sypheros, the Shadow     | Smoky gray                  | Mabar            | Shadow            | 193,000 miles         | 32 days                  |
| 11  | Aryth, the Gateway       | Orange-red                  | Dolurrh          | Passage           | 221,000 miles         | 36.8 days                |
| 12  | Vult, the Warding Moon   | Gray and pockmarked         | Shavarath        | Warding           | 252,000 miles         | 42 days                  |
|     | Crya, the Lonely Dreamer | Deep, dark blue             | Dal Quor         |                   | ~400,000 miles        | 66.6 days                |
^shardshapce-astronomical-bodies

### Random Encounters

| d100  | Encounter                                                                                                                                    | Attitude     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 01-05 | `encounter: 1d12: Brown Scavver` swimming in a school                                                                                        | `dice:2d6`   |
| 06-10 | `encounter: 1d12: Space Eel` swimming in a school                                                                                            | `dice:2d6`   |
| 11-15 | `encounter: 1d12: Space Guppy` swimming in a school                                                                                          | `dice:2d6`   |
| 16-20 | `encounter: 1d8: Star Lancer` swimming in a school                                                                                           | `dice:2d6`   |
| 21-25 | `encounter: 1d8: Space Dolphin` swimming in a pod                                                                                            | `dice:2d6+2` |
| 26-30 | `encounter: 1d8: Kindori` swimming in a pod                                                                                                  | `dice:2d6+2` |
| 31-34 | `encounter: 1d4: Jammer Leech` with any hostile ones successfully attaching to the ship                                                      | `dice:2d6-2` |
| 35-38 | `encounter: 2d10: Goon Balloon` land on the ship                                                                                             | `dice:2d6-4` |
| 39-42 | Chest containing 1d100 gp, 2d100 sp, and 3d100 cp, which is actually a `encounter: 1: Mimic` that doesn’t need to breathe air                | `dice:2d6-1` |
| 43-46 | A vast tangle of driftwood, with `encounter: 1d2: Yggdrasti` hiding among it                                                                 | `dice:2d6-2` |
| 47-50 | `encounter: 1: Gadabout` who's badly withered but can be nursed back to health with water and a successful DC 12 Intelligence (Nature) check | `dice:2d6+2` |
| 51-55 | A dust cloud reduces visibility to 60 feet for the next 8 hours, roll another encounter                                                      |              |
| 56-60 | A gas cloud causes all creatures to become poisoned for the next 8 hours, roll another encounter                                             |              |
| 61-64 | Field of scrap metal, 10 percent chance that `encounter: 2d6: Flying Sword, 1: Helmed Horror` hide among it                                  | `dice:2d6-2` |
| 65-68 | `encounter: 2d8: Gas Spore` that don’t need to breathe air                                                                                   | `dice:2d6-2` |
| 69-72 | `encounter: 1: Fractine` reflecting the ship’s appearance back                                                                               | `dice:2d6-4` |
| 73-74 | `encounter: 1: Esthetic`                                                                                                                     | `dice:2d6-2` |
| 75-76 | `encounter: 1: Murder Comet`                                                                                                                 | `dice:2d6-3` |
| 77-78 | `encounter: 1: Young Solar Dragon`                                                                                                           | `dice:2d6-1` |
| 79-80 | `encounter: 1: Young Lunar Dragon`                                                                                                           | `dice:2d6-2` |
| 81-82 | `encounter: 1: Asteroid Spider`                                                                                                              | `dice:2d6-3` |
| 83-84 | `encounter: 1: Living Star`                                                                                                                  | `dice:2d6`   |
| 85-90 | The Gorgon, the ship built by Houses Cannith and Lyrandar and captained by Lei d'Cannith (as outlined in the Eberron Space Race section of [[Shardjammer]]) |              |
| 91-96 | [[14. Susurrus, Palace of Whispers]], the headquarters of the rogue githyanki sect known as The Whisperers                                   |              |
| 97-98 | Sarcophagus surrounded by permanent black tentacles (as per the spell), with `encounter: 1: Eldritch Lich` inside                            | `dice:2d6-8` |
| 99-00 | `encounter: 1: Mind Flayer Arcanist, 1: Intellect Devourer` both in magical stasis bound in a giant Khyber dragonshard. They reactivate if the shard is damaged in any way. | `dice:2d6-8` |
^shardspace-random-encounters

### References

* [https://www.reddit.com/r/Eberron/comments/xo4fwd/map_of_eberrons_moons_and_time_to_travel_both/](https://www.reddit.com/r/Eberron/comments/xo4fwd/map_of_eberrons_moons_and_time_to_travel_both/)
