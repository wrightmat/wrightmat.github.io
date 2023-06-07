---
statblock: inline
---
#monster 

```statblock
name: Galvanice Weird
size: Medium
type: elemental
alignment: chaotic neutral
ac: 12
hp: 22
hit_dice: 3d8+9
speed: 30 ft.
stats: [14, 10, 17, 3, 10, 5]
damage_resistances: Cold; Lightning; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks
damage_immunities: Poison
condition_immunities: exhaustion, grappled, paralyzed, petrified, poisoned, prone, restrained, unconscious
senses: darkvision 60 ft., passive perception 10
languages: --
cr: 1
traits:
  - name: Death Burst
    desc: "When the galvanice weird dies, it explodes in a burst of ice and lightning. Each creature within 10 feet of the exploding weird must make a DC 13 Dexterity saving throw, taking 7 (2d6) lightning damage on a failed save, or half as much damage on a successful one."
actions:
  - name: Slam
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit:5 (1d6 + 2) bludgeoning damage plus 5 (2d4) lightning damage. If the target is a creature, it must succeed on a DC 13 Constitution saving throw or lose the ability to use reactions until the start of the weird’s next turn."
```