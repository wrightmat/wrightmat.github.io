#location [[Akkala Region]]

Deep Akkala is a sub-region of the Akkala Region. It is in the north-west of the region, bordering Eldin.

### Locations

* [[Akkala Research Lab]]
* [[East Akkala Stable]]
* Spring of Power
* Akkala Wilds
* Bloodleaf Lake
* North Akkala Foothill
* North Akkala Valley
* Rok Woods
* Skull Lake
* Tempest Gulch
* Tumlea Heights

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12   | Collectible    | Qty (12) |
| ----- | -------------- | -------- |
| 1-4   | Zapshroom      | 4        |
| 5-7   | Firefruit     | 3        |
| 8-9   | Dazzledrupe   | 2        |
| 10-11 | Stamella Shroom | 2        |
| 12    | Fairy          | 1        |
^deep-akkala-foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-6 | Mighty Porgy | 6       |
^deep-akkala-fishing
