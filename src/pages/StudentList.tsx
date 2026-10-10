import { useEffect, useState } from 'react';
import { Table } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import type { StudentData } from '../data/datas';

export default function StudentList() {
  const { user, viewRole } = useAuth();
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/students`, { headers: authHeaders(user, viewRole) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load assigned students.');
        return data as StudentData[];
      })
      .then(data => { if (!cancelled) setStudents(data); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load assigned students.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, viewRole]);

  return (
    <Layout>
      <div className="p-4" style={{ background: 'var(--bg-page)', flex: 1, overflowY: 'auto' }}>
        <h2 className="mb-3" style={{ color: 'var(--navy)', fontWeight: 700 }}>Student Members</h2>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Name</th>
              <th>Specialty</th>
              <th>Course</th>
              <th>Year</th>
              <th>Group</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center">Loading students...</td></tr>
            ) : students.length ? students.map(student => (
              <tr key={student.id}>
                <td>{student.name}</td>
                <td>{student.specialty}</td>
                <td>{student.course}</td>
                <td>{student.year}</td>
                <td>{student.group === '--' ? '—' : student.group}</td>
                <td>{student.status}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="text-center">No students have been assigned to you yet.</td></tr>
            )}
          </tbody>
        </Table>
      </div>
    </Layout>
  );
}
