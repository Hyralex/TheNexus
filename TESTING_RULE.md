# ⚠️ TESTING RULE - READ THIS FIRST

## **NEVER Test in `thenexus` Project**

The `thenexus` project is for **PRODUCTION WORK ONLY**.

## **ALWAYS Use `testproject` for Testing**

```bash
# Before testing any TheNexus feature:
pm project switch testproject

# Or specify project explicitly:
pm task add "Test task" --project testproject
curl -X POST http://localhost:3000/api/tasks/start \
  -d '{"taskId":"task-XXX","project":"testproject"}'
```

## **Why This Matters**

- `thenexus` = Real development tasks, clean dashboard
- `testproject` = Testing sandbox, can be messy

Testing in `thenexus` pollutes the production dashboard with test tasks.

## **Clean Up After Testing**

```bash
pm task delete task-XXX --project testproject
```

---

**This rule has been violated multiple times. Don't be the reason it happens again.**
