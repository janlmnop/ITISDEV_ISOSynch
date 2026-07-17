document.addEventListener("DOMContentLoaded", async () => {

    const currentUser = JSON.parse(localStorage.getItem("currentUser"));

    if (!currentUser) {
        window.location.href = "/login";
        return;
    }

    document.getElementById("profileName").textContent =
        `${currentUser.firstName} ${currentUser.lastName}`;

    document.getElementById("avatar").textContent =
        `${currentUser.firstName[0]}${currentUser.lastName[0]}`.toUpperCase();

    let profilePicture = currentUser.profilePicture || "";

    // Load profile from server
    try {

        const response = await fetch(`/api/profile/${currentUser.id}`);

        const user = await response.json();

        document.getElementById("firstName").value = user.firstName;
        document.getElementById("lastName").value = user.lastName;
        document.getElementById("email").value = user.email;
        document.getElementById("mobile").value = user.mobile;
        document.getElementById("course").value = user.course;
        document.getElementById("year").value = user.year;

        profilePicture = user.profilePicture || "";

    } catch (err) {

        alert("Unable to load profile.");

    }

    // Convert uploaded image to Base64
    document.getElementById("profilePicture").addEventListener("change", function () {

        const file = this.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = function (e) {

            profilePicture = e.target.result;

        };

        reader.readAsDataURL(file);

    });

    // Save profile
    document.getElementById("saveBtn").addEventListener("click", async () => {

        const updatedUser = {

            firstName: document.getElementById("firstName").value.trim(),

            lastName: document.getElementById("lastName").value.trim(),

            mobile: document.getElementById("mobile").value.trim(),

            course: document.getElementById("course").value.trim(),

            year: document.getElementById("year").value.trim(),

            profilePicture

        };

        const response = await fetch(`/api/profile/${currentUser.id}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(updatedUser)

        });

        const data = await response.json();

        if (!response.ok) {

            alert(data.error);

            return;

        }

        localStorage.setItem("currentUser", JSON.stringify(data));

        alert("Profile updated successfully!");

        location.reload();

    });

});