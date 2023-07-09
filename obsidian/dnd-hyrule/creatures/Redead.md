---
statblock: inline
---
#monster 

```statblock
image: [[https://static.wikia.nocookie.net/zelda_gamepedia_en/images/7/7e/OoT_ReDead_Artwork.png]]
name: Redead
size: Medium
type: Undead
alignment: Neutral Evil
ac: 8
hp: 22
hit_dice: 3d8 + 9
speed: 10 ft.
stats: [13, 7, 16, 3, 6, 5]
saves:
  - wisdom: 2
damage_immunities: poison
condition_immunities: charmed, exhaustion, frightened, poisoned
senses: blindsight 60 ft., passive Perception 8
languages: understands the languages it knew in life but can't speak
cr: 1/4
traits:
  - name: Undead Fortitude.
    desc: "If damage reduces the redead to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the redead drops to 1 hit point instead."
  - name: Petrifying Gaze.
    desc: "The redead targets one creature it can see within 60 feet of it. If the target can see the redead, it must succeed on a DC 11 Wisdom saving throw against this magic or become frightened until the end of the redead's next turn. If the target fails the saving throw by 5 or more, it is also paralyzed for the same duration. A target that succeeds on the saving throw is immune to the Petrifying Gaze of all ReDeads for the next 2 hours."
actions:
  - name: Bite.
    desc: "Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 8 (2d6 +1) piercing damage plus 3 (1d6) necrotic damage. If the target is a creature, it must make a DC 12 Strength saving throw or the redead remains attached to the creature and takes 8 (2d6 + 1) piercing damage plus 3 (1d6) necrotic damage on each turn until the target succeeds on the saving throw or the redead is killed."
```
