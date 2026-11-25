-- Fictional demo donors. Run after schema.mysql.sql.
USE pulseconnect;
INSERT IGNORE INTO donors (donor_id, name, blood_group, age, location, phone, status, registered_date) VALUES
  (1001, 'Aarav Patel', 'AB-', 26, 'Ahmedabad, Gujarat, India', '+91 9879123456', 'Available', '2026-10-12'),
  (1002, 'Priya Iyer', 'A+', 24, 'Chennai, Tamil Nadu, India', '+91 9840223456', 'Available', '2026-10-18'),
  (1003, 'Rohan Mehta', 'B+', 32, 'Delhi, NCR, India', '+91 9811334567', 'Available', '2026-10-22'),
  (1004, 'Ananya Mukherjee', 'AB+', 22, 'Kolkata, West Bengal, India', '+91 9830445678', 'Available', '2026-10-29'),
  (1005, 'Vikramaditya Rao', 'O-', 35, 'Bengaluru, Karnataka, India', '+91 9880556789', 'Available', '2026-11-02'),
  (1006, 'Sneha Kulkarni', 'A-', 29, 'Pune, Maharashtra, India', '+91 9822667890', 'Available', '2026-11-05'),
  (1007, 'Kabir Verma', 'O+', 27, 'Mumbai, Maharashtra, India', '+91 9820112233', 'Available', '2026-11-10'),
  (1008, 'Divya Nair', 'B-', 31, 'Kochi, Kerala, India', '+91 9847123456', 'Available', '2026-11-14'),
  (1009, 'Aarthi sharma', 'A-', 30, 'Chennai, Tamil Nadu, India', '+91 7483648744', 'Available', '2026-11-22'),
  (1010, 'Rahul Deshmukh', 'O+', 28, 'Mumbai, Maharashtra, India', '+91 9820443322', 'Available', '2026-11-18'),
  (1011, 'Meera Nambiar', 'B+', 25, 'Bengaluru, Karnataka, India', '+91 9845112233', 'Available', '2026-11-20'),
  (1012, 'Siddharth Joshi', 'A+', 33, 'Pune, Maharashtra, India', '+91 9823556677', 'Available', '2026-11-21');
