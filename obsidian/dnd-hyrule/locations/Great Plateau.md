#district [[Central Region]]

The Great Plateau, with its seat well above the rest of the land, serves as central protectorate of Hyrule. While Hyrule Castle is home to its governmental might, and Akkala Citadel houses its young and exuberant military power, the heart of Hyrule contains the ancient wisdom of both the elder soldiers (at the rebuilt Temple of Time) and its oldest sages (at the rebuilt Eastern Abbey). These serve as the martial and magical arms of the Champions of Hyrule.

Any NPC on the Great Plateau will inform the players of both the Poes in the Fog and The Cartography Chamber missions. If asked about the purple clouds, they may mention that they're reminiscent of the Calamity Ganon that appeared a few generations ago.

### Locations

- Temple of Time
	- Rebuilt from the ruins, this temple also has a small alter in front of the Goddess Statue that depicts the Song of Time (see [[1. Central Windvane and Warp Songs]]).
- Eastern Abbey
- Cartography Chamber
- Forest of Spirits
- Mount Hylia
- River of the Dead

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

### Faction: Champions of Hyrule

![[Champions of Hyrule]]

### Collecting

##### Foraging

| d12  | Collectible          | Qty (12) |
| ---- | -------------------- | -------- |
| 1-2  | Hyrule Herb          | 2        |
| 3-4  | Hylian Shroom        | 2        |
| 5-6  | Hylian Grains        | 2        |
| 7-8  | Hylian Tomato Pepper | 2        |
| 9-10 | Apple                | 2        |
| 11   | Rushroom             | 1        |
| 12   | Fairy                | 1        |
^great-plateau-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-6 | Hyrule Bass    | 6       |
^great-plateau-fishing
