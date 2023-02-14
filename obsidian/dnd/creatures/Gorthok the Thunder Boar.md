---
statblock: inline
---
#monster 

```statblock
name: Gorthok the Thunder Boar
size: Huge
type: monstrosity
alignment: chaotic evil
ac: 15
hp: 72
hit_dice: 7d12+28
speed: 50 ft.
stats: [20, 11, 19, 6, 10, 14]
damage_resistances: Bludgeoning, Piercing, and Slashing from Nonmagical Attacks
damage_immunities: Lightning; Thunder
senses: darkvision 60 ft., passive perception 10
languages: --
cr: 6
traits:
  - name: Relentless (Recharges after a Short or Long Rest)
    desc: "If Gorthok takes 27 damage or less that would reduce it to 0 hit points, it is reduced to 1 hit point instead."
actions:
  - name: Multiattack
    desc: "Gorthok makes two melee attacks: one with its lightning tusks and one with its thunder hooves."
  - name: Lightning Tusks
    desc: "Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 12 (2d6 + 5) slashing damage plus 7 (2d6) lightning damage."
  - name: Thunder Hooves
    desc: "Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 12 (2d6 + 5) bludgeoning damage plus 7 (2d6) thunder damage."
  - name: Lightning Bolt (Recharge 6)
    desc: "Gorthok shoots a bolt of lightning at one creature it can see within 120 feet of it. The target must make a DC 15 Dexterity saving throw, taking 18 (4d8) lightning damage on a failed save, or half as much damage on a successful one."
```