document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const response = await fetch('/api/adduser', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();
    const messageEl = document.getElementById('message');

    if (result.success) {
        messageEl.textContent = 'User added successfully!';
        messageEl.style.color = 'green';
        form.reset();
    } else {
        messageEl.textContent = `Error: ${result.error}`;
        messageEl.style.color = 'red';
    }
});
