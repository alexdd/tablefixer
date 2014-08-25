## (c) Alex Duesel 2014 <http://www.mandarine.tv>

import re

input_file = open('broken.sgml','r')
tag_ended = False
buff = ""
pos = 0
tags = []
row_counter = 0
entry_counter = 0
table_counter = 0
ncols = 0
more_rows = []
entries = []
colspecs = []
broken_tags = []
tmp_row = []
content = ""
tree = {}
log = ""

## read data

while 1:
  character = input_file.read(1)
  if not character:
    input_file.close()
    break
  if character == '>':
    tag_ended = True
  elif character == '<':
    tags.append((pos,buff,content))
    pos+=1
    buff = ""
    content = ""
    tag_ended = False
  elif not tag_ended:
    buff+=character
  else:
    content+=character
tags.append((pos,buff,content))

## analyze data

for tag in tags:
  if tag[1].lower().startswith("table"):
    row_counter = 0
    ncols = 0
    more_rows = []
    table_counter += 1
    colspecs = []
  elif tag[1].lower().startswith("tgroup"):
    try:
      ncols = int([attr.split("=") for attr in tag[1].split(" ") \
              if attr.lower().startswith("cols")][0][1].strip('"/'))
    except:
      log+= "<!-- ERROR: @cols not declared! -->\n"
    for i in range(ncols):
      more_rows.append(0)
  elif tag[1].lower().startswith("colspec"):
    try:
      colname = [attr.split("=") for attr in tag[1].split(" ") \
              if attr.lower().startswith("colname")][0][1].strip('"/')
    except:
      log +="<!-- ERROR: colspec inconsistent! -->\n"
    colspecs.append(colname)
  elif tag[1].lower().startswith("row"):
    row_counter += 1
    entry_counter = 0
    entries = []
    tmp_row = []
    tmp_row.append(tag)
  elif tag[1].lower().startswith("/entry"):
    tmp_row.append(tag)
  elif tag[1].lower().startswith("entry"):
    morerows=0
    namest=None
    nameend=None
    for attr in tag[1].split(" "):
      if attr.lower().startswith("morerows"):
        morerows = int(attr.split("=")[1].strip('"/'))
      elif attr.lower().startswith("namest"):
        namest = attr.split("=")[1].strip('"/')
      elif attr.lower().startswith("nameend"):
        nameend = attr.split("=")[1].strip('"/')
    if namest and nameend:
      pass
    elif namest or nameend:
      log+= "<!-- ERROR: namest or nameend inconsistent! Table %s -->\n" % table_counter
    entries.append({ "morerows" : morerows, "namest" : namest, "nameend" : nameend})
    tmp_row.append(tag)
  elif tag[1].lower().startswith("/row"):
    resolved_entries = []
    for entry in entries:
      if entry["namest"] and entry["nameend"]:
        spanning = 0
        try:
          start = colspecs.index(entry["namest"])
          end = colspecs.index(entry["nameend"])
          spanning = abs(end-start)
        except:
          log += "<!-- ERROR: @namest or @namend no correspondence in colspec! Table %s -->\n"% table_counter
        for i in range(spanning):
          resolved_entries.append(entry["morerows"])
      resolved_entries.append(entry["morerows"])
    ncells = len(resolved_entries) 
    nspans = len([num for num in more_rows if num > 0])
    added = 0
    if ncells + nspans > ncols: # this is the culprit
      if len(tmp_row) in (2,3) and tmp_row[1][2].strip(" \n\r") == "":
        broken_tags.append(tmp_row)
        added = 1
      log+="<!-- FIXED EPIC ERROR: @morerows attributes inconsistent! Table %s Row %s -->\n" % (table_counter, row_counter)
    i = 0
    for j in range(ncols):
      if more_rows[j] > 0:
        more_rows[j] -= 1
      elif i < ncells:
        tmp = resolved_entries[i]
        if tmp > 0:
          more_rows[j] = tmp
        i+=1
      else:
        log+= "<!-- FIXED ERROR @morerows attributes inconsistent! Table %s Row %s -->\n" % (table_counter, row_counter)
        if len(tmp_row) in (2,3) and tmp_row[1][2].strip(" \n\r") == "":
          broken_tags.append(tmp_row)
        break
  elif tag[1].lower().startswith("/table"):
    spans = [num for num in more_rows if num > 0]    
    if len(spans) > 0:
      log+= "<!-- ERROR: @morerows attributes incinsistent! Table %s -->\n" % table_counter
  tree[str(tag[0])] = [tag[1],tag[2]]
  
## fix data

del tree["0"] 
for tag in reversed(broken_tags):
  del tree[str(tag[0][0])] # delete the culprit
  i = 1
  while not "/row" in tree[str(tag[0][0]+i)][0].lower():
    del tree[str(tag[0][0]+i)]
    i+=1
  del tree[str(tag[0][0]+i)]
  num = tag[0][0]
  row_counter = 0
  while num > 1: # adjust preceding morerows settings go up until top of table
    num-=1
    elem = tree[str(num)]
    if elem[0].lower().startswith("row"):
      row_counter += 1
    elif elem[0].lower().startswith("entry"):
      try:
        morerows = int([attr.split("=") for attr in elem[0].split(" ") \
                  if attr.lower().startswith("morerows")][0][1].strip('"'))
      except:
        morerows = 0
      if row_counter <= morerows: #check if already enough rows traversed and
        new_morerows = morerows - 1 # there is no more span reaching
      else:
        new_morerows = morerows
      elem[0] = re.sub(r'MOREROWS=\"[0-9]*\"','MOREROWS=\"' \
                    +str(max(0,new_morerows))+'\"',elem[0], flags=re.I)
      tree[str(num)] = elem

## output data

print log
for key in sorted(tree.keys(),key=int):
  print "<"+tree[key][0]+">"+tree[key][1],
