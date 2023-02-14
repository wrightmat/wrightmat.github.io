---
statblock: inline
---
#monster 

```statblock
name: Wild Mange
size: Medium
type: Humanoid
subtype: (gnoll, shapechanger)
alignment: Chaotic Evil
ac: 14
hp: 58
hit_dice: 9d8  + 18
speed: 30 ft.
stats: [15, 14, 14, 10, 11, 10]
saves:
  - dexterity: 4
damage_immunities: Bludgeoning, Piercing, and Slashing from Nonmagical Attacks that aren't Silvered
senses: Darkvision 60 ft., Passive Perception 14
languages: Common, Undercommon
cr: 4
traits:
  - name: Rampage.
    desc: "When the Wild Mange reduces a creature to 0 hit points with a melee attack on its turn, the Wild Mange can take a bonus action to move up to half its speed and make a bite attack."
  - name: Shapechanger.
    desc: "The Wild Mange can use its action to polymorph into a creature-humanoid hybrid or back into its true form, which is humanoid. Its statistics, other than its AC, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies."
  - name: Curse of the Wild Mange.
    desc: "When a spellcaster is under the effects of Wild Mange lycanthropy, each spell they cast while cursed triggers a Wild Magic Surge. See the Sorcerer's Wild Magic table in the PHB."
actions:
  - name: Mad Multiattack.
    desc: "Roll 2 (1d4) at the beginning of each of the Wild Mange's turns to determine how many attacks it can make each round. Using this pool of actions the Wild Mange can attack in the following ways:"
  - name: Bite.
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 6 (2d4 + 2) piercing damage. If the target is a humanoid, it must succeed on a DC 12 Constitution saving throw or be cursed with Wild Mange lycanthropy."
  - name: Spell Scythe.
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 8 (1d6 + 2) slashing damage. On a hit, the Wild Mange drains one spell slot of the targets lowest level available and regains 8 (2d4+4) hit points."
  - name: Scintillating Strobe.
    desc: "The Wild Mange emits a blinding array of colors. Any creature  within 5 ft of the creature must succeed on a DC 12 Wisdom saving throw or become stunned until the end of the victim's next turn."
  - name: Shock Step.
    desc: "The Wild Mange teleports up to 60 feet. Immediately after it disappears, the tear in reality bursts, and each creature within 10 feet of the space the Wild Mange formerly occupied must make a DC 12 Constitution saving throw, taking 2d6 lightning damage on a failed save, or half as much damage on a successful one."
reactions:
  - name: Chaotic Crescendo.
    desc: "When the Wild Mange is reduced to 0 hit points, it explodes. Each creature within 15 feet of the Wild Mange must make a DC 12 Dexterity saving throw, taking 10 (2d10) lightning damage on a failed save, or half as much damage on a successful one. When the Wild Mange is reduced to 0 hit points roll once on the Sorcerer's Wild Magic table and proceed with the following effect."
```