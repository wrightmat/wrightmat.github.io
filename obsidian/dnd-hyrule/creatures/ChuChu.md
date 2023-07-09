---
statblock: inline
---
#monster 

```statblock
image: [[https://64.media.tumblr.com/40f87dbc38bbe7896d2c0d096d652b58/tumblr_ov5sc9oseT1ul80klo1_500.png]]
name: ChuChu
size: Medium
type: Ooze
alignment: Unaligned
ac: 8
hp: 65
hit_dice: 10d8 + 20
speed: 20 ft.
stats: [13, 6, 14, 1, 9, 8]
damage_resistances: acid
damage_immunities: damage type matching the chuchu's elemental cloak if it has one
senses: Darkvision 60 ft., Tremorsense 10 ft., passive Perception 9
languages: --
cr: 1
traits:
  - name: Amorphous.
    desc: "The chuchu can move through a space as narrow as 1 inch wide without squeezing."
  - name: Elemental Cloak.
    desc: "The chuchu is visibly and magically cloaked with an energy matching the damage type to which it is immune, based on its color."
  - name: Shocking Cloak.
    desc: "The chuchu only has this trait if has an elemental cloak of lightning. Any creature which touches it directly or with an electricity-conducting weapon (including most metal weapons) takes 7 (2d6) lightning damage. If the creature takes this damage, it must also succeed on a DC 13 Constitution saving throw or drop everything it is holding and be paralyzed until the end of its next turn."
actions:
  - name: Slam.
    desc: "Melee Weapon Attack. +3 to hit, reach 5 ft., one target. Hit: 7 (1d12 + 1) bludgeoning damage, plus an extra 7 (2d6) damage of type matching the chuchu's elemental cloak if it has one."
  - name: Swallow.
    desc: "Melee Weapon Attack. +3 to hit, reach 5 ft., one creature at least one size category smaller than the chuchu. Hit: The target is grappled (escape DC 14), and restrained for the duration of the grapple. While the target is grappled, at the beginning of each of the chuchu's turn the target takes 9 (2d8) acid damage plus an extra 5 (1d10) of a damage type matching the chuchu's elemental cloak if it has one. While the target is grappled, the chuchu cannot swallow another target."
  - name: Withdraw.
    desc: "The chuchu reduces itself to a formless puddle on the ground, and remains as such until the start of its next turn. While withdrawn, the chuchu is incapacitated; it has immunity to nonmagical bludgeoning, piercing, and slashing damage; and it has resistance to magical bludgeoning, piercing, and slashing damage."
reactions:
  - name: Burst.
    desc: "The chuchu can only use this reaction if it has an elemental cloak. When reduced to 0 HP, a burst of magical energy gushes from the chuchu in all directions. Every creature within 15 feet of the chuchu must make a DC 12 Dexterity saving throw. A creature takes 11 (2d10) damage on a failed save, or half as much on a successful one. The damage type matches that of the chuchu's elemental cloak."
```

### Description

ChuChus are gelatinous lifeforms with limited mobility and even more limited ambitions. They subsist almost entirely on whatever organisms happen to stray into contact with their bodies, and can go upward of several months without taking in any nourishment at all. They come in a variety of colors and sizes, each of which provides its own protection against any creatures that might wish to do them harm. When provoked, they are capable of short hops toward an enemy. Upon death, a ChuChu's bodily plasma begins to lose its cohesion, and can be harvested and refined into a variety of potions with effects that also correspond to the creature's color.

##### ChuChu Colors and Effects

| d6  | Color  | Elemental Cloak |                                         Potion Effect                                          |
| --- |:------:|:---------------:|:----------------------------------------------------------------------------------------------:|
| 1   |  Blue  |      None       |                                  Restores 2d4 + 2 hit points                                   |
| 2   | Green  |      None       |                            Restores one Lvl 1 spell or stamina slot                            |
| 3   |  Red   |      Fire       |                                     Grants fire resistance                                     |
| 4   | White  |      Cold       |                                     Grants cold resistance                                     |
| 5   | Yellow |    Lightning    |                                    Grants shock resistance                                     |
| 6   | Purple |     Poison      | Make a DC 18 Con save, taking 2d6 poison damage on a failure, or gaining 4d4+4 HP on a success |
^random-chuchu-color

### References

* https://www.dandwiki.com/wiki/Chuchu_(5e_Creature)
* https://homebrewery.naturalcrit.com/edit/ByEQkXGZc4
