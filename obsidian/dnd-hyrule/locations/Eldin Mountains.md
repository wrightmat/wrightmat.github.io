#location [[Eldin Region]]

The Eldin Mountains is the mountain range forming the north-west of the Eldin Region.

### Locations

* [[Typhlo Ruins Tower]]
* Deplian Badlands
* Drenan Highlands
* Eldin Great Skeleton
* West Deplian Badlands
* East Deplian Badlands
* Gut Check Rock

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible  | Qty (12) |
| ---- | ------------ | -------- |
| 1-5  | Sunshroom    | 5        |
| 6-8  | Ironshroom   | 3        |
| 9-10 | Firefruit   | 2        |
| 11   | Swift Violet | 1        |
| 12   | Fairy        | 1        |
^eldin-mountains-foraging

##### Fishing

| d6  | Collectible      | Qty (6) |
| --- | ---------------- | ------- |
| 1-4 | Sizzlefin Trout  | 4       |
| 5-6 | Stealthfin Trout | 2       |
^eldin-mountains-fishing
