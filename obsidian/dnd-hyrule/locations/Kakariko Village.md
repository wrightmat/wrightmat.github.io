#location #village [[West Necluda]]

Kakariko is a settlement in the West Necluda region of Hyrule, north of the Dueling Peaks. It is the home of most of the living Sheikah in Hyrule.

>Kakariko is airily ensconced in a mountain vale, under a close sun and towering peaks. The Pillars of Levia — marked stone columns in a jeweled lake of green grass — rise far above the village, natural fortresses in the southern hills. A lively stream falls from a healthy woodland at the foot of these columns, cascading down the terraced face of the village, eventually coming to rest in a diminutive pool around a statue of the Goddess Hylia. From the west, Lantern Lake pours its waters into yet another pond from a series of many-tiered falls in the cliff-side. These two waters almost meet, but for a short expanse of land before Seeker Hall. The distinctive glow of a Great Fairy Fountain can be seen in the eastern distance. Modest fruit-bearing trees, mostly plums, are planted predominantly in front of houses and shops. Tended carefully by at least one dedicated naturalist in the village, and surrounded by cuccos running free, the buds are just opening when you arrive, yielding tender pinks, whites, and purples. Alongside the plum orchard and apple trees can be found several fields which provide Kakariko with its two most famous crops: carrots and pumpkins.

The Ring Ruins, and all other debris that had hit Kakariko, are gone. The Zonai Survey Team that was headquartered out of Kakariko has disbanded, with little left to study. Although a few of the members have transitioned to a new group, known as the Sheikah Seekers. This group has a similar mission to seek out information and magical artifacts, but also understands that knowledge leads to power and too much power can be dangerous (as learned from all the recent events).

### Locations

- Seeker Hall
	- On the wall is a poster depicting the Sheikah Seekers symbol and the notes to the "Nocturne of Shadow" (see [[1. Central Windvane and Warp Songs]]).
- Great Fairy Fountain
- High Spirits Produce, a general store
- The Curious Quiver, a weapons shop
	- Arrows x5, (20 rupees)
	- Fire Arrows x5 (80 rupees)
- Enchanted, an armor shop
- Shuteye Inn
	- Regular bed (20 rupees)
	- Soft bed (40 rupees): grants (1) temporary heart
- Pikango Pottery

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Faction: Sheikah Seekers

![[Sheikah Seekers]]