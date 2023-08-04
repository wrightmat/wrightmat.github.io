#location #village [[Hebra Mountains]]

Located in the center of the Hebra Mountains, between the East Summit and Hebra Tundra, a small village has developed around a log cabin that used to be alone in the mountains. Stories swirl about a group of intensely capable Rito knights who claimed the area for their order, but most Rito (and especially any Hylians) aren't willing to explore the area enough to uncover the truth.

Selmie, who used to live in the lone cabin, now resides in a different log cabin further down the mountain and closer to Rito Village, known as the Hebra Trailhead Lodge. She still challenges willing participants with Shield Surfing Challenges, as well as providing guide services for a price. She is reticent to talk about her experiences with the Rito knights and wants to just move on with her life.

While Rito Village has opened up more to non-Rito, Hebra Village has a strict Rito-only policy. The very knights who originally founded the village, known as the Fokka Order, protect the village from outsiders.

### Locations

* Brass Bird Armor Shop
* Warrior Wing Weapon Shop

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
