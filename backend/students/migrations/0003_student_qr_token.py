import uuid

from django.db import migrations, models


def issue_tokens(apps, schema_editor):
    """Give every existing member their own pass.

    The field default is evaluated once per column, not once per row, so
    adding a unique field to a populated table in one step would try to write
    the same UUID everywhere and collide. Hence add, fill, then constrain.
    """
    Student = apps.get_model("students", "Student")
    for student in Student.objects.all().iterator():
        Student.objects.filter(pk=student.pk).update(qr_token=uuid.uuid4())


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0002_student_photo_alter_student_status_memberdocument"),
    ]

    operations = [
        migrations.AddField(
            model_name="student",
            name="qr_token",
            field=models.UUIDField(default=uuid.uuid4, editable=False, null=True),
        ),
        migrations.RunPython(issue_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="student",
            name="qr_token",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
