---
statblock: inline
---
#monster 

```statblock
name: Giant Skeleton
size: Huge
type: undead
alignment: neutral evil
ac: 17
hp: 115
hit_dice: 10d12+50
speed: 30 ft.
stats: [21, 10, 20, 4, 6, 6]
senses: blindsight 60 ft., passive perception 10
damage_vulnerabilities: bludgeoning
damage_immunities: poison
condition_immunities: Exhausted, Poisoned
languages: understands Giant but can’t speak
cr: 7
traits:
  - name: Evasion
    desc: "If the skeleton is subjected to an effect that allows it to make a saving throw to take only half damage, it instead takes no damage if it succeeds on the saving throw, and only half damage if it fails."
  - name: Magic Resistance
    desc: "The skeleton has advantage on saving throws against spells and other magical effects."
  - name: Turn Immunity
    desc: The skeleton is immune to effects that turn undead.
actions:
  - name: Multiattack
    desc: "The skeleton makes three scimitar attacks."
  - name: Scimitar
    desc: "Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 15 (3d6 + 5) slashing damage."
```