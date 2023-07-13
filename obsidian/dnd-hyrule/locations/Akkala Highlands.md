#location [[Akkala Region]]

The Akkala Highlands are a sub-region of Akkala Region, comprised of the southern area of the region.

### Locations

* [[Akkala Citadel Town]]
* [[Tarrey Town]]
* Great Fairy Fountain (Mija)
* Kaepora Pass
* Kanalet Ridge
* Lake Akkala
* Ordorac Quarry
* Shadow Pass
* South Akkala Plains
* South Lake Akkala
* Torin Wetland
* Ulri Mountain

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
| 1-4  | Armoranth    | 4        |
| 5-8  | Hyrule Herb  | 4        |
| 9-11 | Dazzledrupe | 3        |
| 12   | Fairy        | 1        |
^akkala-highlands-foraging

##### Fishing

| d6  | Collectible   | Qty (6) |
| --- | ------------- | ------- |
| 1-2 | Hyrule Bass   | 2       |
| 3-4 | Mighty Porgy  | 2       |
| 5-6 | Hearty Salmon | 2       |
^akkala-highlands-fishing
