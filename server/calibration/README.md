Lambda function to return data recorded during in-lab "calibration" sessions: User id, date, Coherence/Calmness, RR data, etc.
Takes subjectId as the sole parameter (/users/{user_id}/calibration) and returns whatever calibration data it finds from the past hour.

To run tests, first run moto_server s3 -p4583.