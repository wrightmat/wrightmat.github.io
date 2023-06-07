---
statblock: inline
---
#monster 

```statblock
name: Skinweaver Head
size: Small
type: Beast
alignment: Unaligned
ac: 17
hp: 108
hit_dice: 27d8
speed: 25 ft., climb 25 ft.
stats: [6, 14, 18, 16, 15, 18]
skillsaves:
  - arcana: 8
  - deception: 5
  - insight: 2
damage_resistances: Nectrotic
damage_immunities: Poison
senses: Blindsight 10 ft, Tremorsense 10 ft, Passive Perception 12
languages: --
cr: 8
actions:
  - name: Vicious Bite.
    desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., 1 target. Hit: 6 (2d6) necrotic damage."
  - name: Dreadful Word.
    desc: "Ranged Weapon Attack: +4 to hit, range 120/300 ft., 1 target. Hit: 11 (2d6 + 5) psychic damage."
  - name: Mucus Web.
    desc: "Each creature in a 15-foot cone originating from the skinweaver must make a DC 16 Dexterity saving throw. On a failed save, a creature falls prone and is grappled. On a successful save, a creature is neither prone nor grappled. The area becomes difficult terrain for the duration of the encounter."
  - name: Arcane Mimicry (Recharge 4-6).
    desc: "The skinweaver head can use one attack or spell of 10th level or below that has been used in the last round and within 50 feet of the head. This is considered to be a standard action, even if the original attack or spell was a bonus action. If the power is an attack, the skinweaver’s attack bonus is +4 and its damage modifier is +5."
bonus_actions:
  - name: Fleshweaving (Recharge 5-6).
    desc: "Any skinweavers within a 10-foot cone regain 10 hit points."
```