#location [[Necluda Region]]

West Necluda is a location found in Breath of the Wild to the East of the Great Plateau. The region is home to the remaining Sheikah Tribe who live in the mountainous Kakariko Village as well as the great Dueling Peaks, a mountain split down the middle with a river flowing through it and its neighbouring stable (Dueling Peaks Stable) at its base.

### Locations

* [[Kakariko Village]]
* [[Dueling Peaks Stable]]
* Hickaly Woods
* Outpost Ruins
* Scout's Hill
* Proxim Bridge
* Hylia River
* Hills of Baumer
* Batrea Lake
* Nabi Lake
* South Nabi Lake
* Squabble River
* Mable Ridge
* Sahasra Slope
* Lantern Lake
* Pillars of Levia
* Lake Siela
* Kakariko Bridge
* Ash Swamp
* Blatchery Plain
* Fort Hateno
* Bubinga Forest
* Oakle's Navel
* Mount Rozudo

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

### Collecting

##### Foraging

| d12 | Collectible       | Qty (12) |
| --- | ----------------- | -------- |
| 1-2 | Apple             | 2        |
| 3-4 | Silent Shroom     | 2        |
| 5-6 | Hylian Shroom     | 2        |
| 7-8 | Rushroom          | 2        |
| 9   | Ironshroom        | 1        |
| 10  | Fleet Lotus Seeds | 1        |
| 11  | Bird Egg          | 1        |
| 12  | Fairy             | 1        |
^west-necluda-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-3 | Hyrule Bass    | 3       |
| 4-5 | Staminoka Bass | 2       |
| 6   | Hearty Salmon  | 1       |
^west-necluda-fishing
