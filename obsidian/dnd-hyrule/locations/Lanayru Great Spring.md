#location [[Lanayru Region]]

Lanayru Great Spring is the large central area of the Lanayru region and the ancestral home of the Zora people.

### Locations

- [[Zora's Domain]]
- [[Upland Zorana Tower]]
* East Reservoir Lake
* Rutala River
* Zora River
* Great Zora Bridge
* Mipha Court
* Veiled Falls

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
| 1-4 | Fleet Lotus Seeds | 4        |
| 5-7 | Silent Shroom     | 3        |
| 8   | Courser Bee Honey | 1        |
| 9   | Hylian Grains     | 1        |
| 10  | Rushroom          | 1        |
| 11  | Stamella Shroom   | 1        |
| 12  | Fairy             | 1        |
^lanayru-great-spring-foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-3 | Armored Carp | 3       |
| 4-6 | Mighty Porgy | 3       |
^lanayru-great-spring-fishing
