A script to automate as much of the collation of calibration data as possible. Given a user id (and an optional cutoff date), it will:

  - Fetch the data from that user's most recent calibration session
  - Store those data into an online Google spreadsheet
  - Run Kubios on the fetched data
  - Extract certain data points from the Kubios output and put them into the Google spreadsheet