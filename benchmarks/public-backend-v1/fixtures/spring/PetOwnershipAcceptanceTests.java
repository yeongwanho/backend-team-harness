package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import static org.junit.jupiter.api.Assertions.*;

/** Supplemental controller/JPA regression audit, not a live HTTP authorization test. */
@DataJpaTest(
		properties = { "spring.datasource.url=jdbc:h2:mem:bth-pet-ownership;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
				"spring.datasource.username=sa", "spring.datasource.password=",
				"spring.datasource.driver-class-name=org.h2.Driver", "spring.sql.init.mode=always",
				"spring.sql.init.schema-locations=classpath:db/h2/schema.sql",
				"spring.sql.init.data-locations=classpath:db/h2/data.sql" })
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class PetOwnershipAcceptanceTests {

	@Autowired
	private OwnerRepository repository;

	@Autowired
	private EntityManager entityManager;

	private Object[] row(int petId) {
		return (Object[]) entityManager
			.createNativeQuery("select owner_id, name, birth_date, type_id from pets where id = :id")
			.setParameter("id", petId)
			.getSingleResult();
	}

	@Test
	void doesNotModifyOrReparentAnotherOwnersPersistentPet() {
		Owner intendedOwner = repository.findById(1).orElseThrow();
		Pet foreignPet = repository.findById(2).orElseThrow().getPets().get(0);
		int foreignId = foreignPet.getId();
		assertNull(intendedOwner.getPet(foreignId));
		Object[] before = row(foreignId);
		Pet submitted = new Pet();
		submitted.setId(foreignId);
		submitted.setName("Foreign pet changed");
		submitted.setBirthDate(LocalDate.of(2013, 2, 3));
		submitted.setType(foreignPet.getType());
		new PetController(repository).processUpdateForm(intendedOwner, submitted,
				new BeanPropertyBindingResult(submitted, "pet"), new RedirectAttributesModelMap());
		entityManager.flush();
		entityManager.clear();
		assertArrayEquals(before, row(foreignId), "An update for owner 1 must leave owner 2's pet row unchanged.");
	}

}
