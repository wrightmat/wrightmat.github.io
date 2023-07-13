#location [[Faron Region]]

Lake Hylia is a large body of water found just southeast of the Great Plateau. The Hylia River and many of its tributaries spill out into Lake Hylia. At the west side of the lake is a large island known as Hylia Island. The Bridge of Hylia extends across the lake, which connects out to the Highland Stable, Lakeside Stable, and all the way out east to Lurelin Village.

### Locations

* [[Highland Stable]]
* Bridge of Hylia
* Hylia Island
* Lake Hylia Whirlpool Cave
* Hylia River
* Farosh Hills
* Cora Lake
* Fural Plain

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible | Qty (12) |
| ---- | ----------- | -------- |
| 1-3  | Apple       | 3        |
| 4-5  | Dazzledrupe | 2        |
| 6-8  | Iceberry    | 3        |
| 9-11 | Hydromelon  | 3        |
| 12   | Fairy       | 1        |
^lake-hylia-foraging

##### Fishing

| d6  | Collectible   | Qty (6) |
| --- | ------------- | ------- |
| 1-4 | Hyrule Bass   | 4       |
| 5-6 | Hearty Salmon | 2       |
^lake-hylia-fishing
