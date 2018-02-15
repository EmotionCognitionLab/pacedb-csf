This directory contains the raw data for the various reminder messages as well as a script to load them into the hrv-[stage]-reminder-msgs table. Note that if you want to change the data the following
must be true:

 - They must be in csv format
 - The first line of the file must be the column names
 - There must be a column named 'id' with numeric values (to match the dynamodb hash key)
 - They must be in the UTF-8 character set

To run it:
`node load-msgs.js region table-name csv-file`