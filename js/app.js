// js/app.js

document.addEventListener("DOMContentLoaded", function() {
    // This function fetches HTML content and injects it into a specified element
    const loadComponent = (componentPath, elementId) => {
        fetch(componentPath)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Could not load ${componentPath}`);
                }
                return response.text();
            })
            .then(html => {
                const placeholder = document.getElementById(elementId);
                if (placeholder) {
                    placeholder.innerHTML = html;
                } else {
                    console.warn(`Placeholder with ID #${elementId} not found.`);
                }
            })
            .catch(error => console.error('Error loading component:', error));
    };

    // Define all the components and their placeholders
    const components = {
        'header.html': 'header-placeholder',
        'contact-info.html': 'contact-info-placeholder',
        'education.html': 'education-placeholder',
        'certifications.html': 'certifications-placeholder',
        'key-competencies.html': 'key-competencies-placeholder',
        'core-technologies.html': 'core-technologies-placeholder',
        'summary.html': 'summary-placeholder',
        'cloud-skills.html': 'cloud-skills-placeholder',
        'cloud-projects.html': 'cloud-projects-placeholder',
        'experience.html': 'experience-placeholder'
    };


    // Loop through and load all components
    for (const [file, id] of Object.entries(components)) {
        loadComponent(`components/${file}`, id);
    }
});