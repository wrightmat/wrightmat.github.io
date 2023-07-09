#location #stable [[Hyrule Field]]

>Rumors linger that Outskirt Stable is the least... reputable stable remaining in Hyrule. It's said that the stable only still exists due to its proximity to the Coliseum that's recently come back in to use. A strange man is often seen there at night, chatting up whoever will talk.

The primary animal raised here is cuccos.

Primary-Purpose:: Cuccos
Region:: Central

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
