import sqlite3
import time

class EmwaveDb:

    def __init__(self, db_file_path):
        self.path = db_file_path
        self.conn = None
        self.c = None

    def open(self):
        self.conn = sqlite3.connect(self.path)
        self.c = self.conn.cursor()

    def close(self):
        if self.conn:
            self.conn.close()

    def _confirm_db_open(self):
        if not self.conn:
            raise Exception('You must call open() before fetching sessions')

    def fetch_session_rr_data(self, username):
        """Returns list of sessions. Each session contains a list of RR intervals (ms between heartbeats).

        username   - The name of the user (as found in User.FirstName in the emwave database) whose data you want
        """
        
        self._confirm_db_open()

        sessions = list()
        stmt = 'select LiveIBI from Session s join User u on s.UserUuid = u.UserUuid where u.FirstName = ? and s.ValidStatus = 1 and s.DeleteFlag is null order by IBIStartTime asc'
        for row in self.c.execute(stmt, (username, )):
            rr_data = list()
            for i in range(0, len(row[0]), 2):
                rr_data.append(int.from_bytes(row[0][i:i+2], byteorder='little'))
            sessions.append(rr_data)

        return sessions

    def fetch_user_first_names(self):
        self._confirm_db_open()
        self.c.execute('select FirstName from User')
        return [i[0] for i in self.c.fetchall()]


    